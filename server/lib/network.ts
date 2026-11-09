import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch as httpFetch } from "undici";
import robotsParser from "robots-parser";
import { JobError, providerName, retryAfter } from "./job-errors.js";
export const userAgent = "ScoutResearchBot/1.0";
export function publicAddress(address: string) {
  try {
    const a = ipaddr.process(address);
    return a.range() === "unicast";
  } catch {
    return false;
  }
}
export function normalizeDomain(input: string) {
  const u = new URL(input.includes("://") ? input : `https://${input}`);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.port ||
    !u.hostname.includes(".")
  )
    throw new Error("A public HTTP(S) domain is required");
  return u.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}
export async function validateTarget(input: string) {
  const url = new URL(input);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("Unsafe target URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    throw new Error("Private network target blocked");
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("Private or reserved network address blocked");
  return { url, addresses };
}
export type SafeResponse = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};
export async function safeFetch(
  input: string,
  options: {
    maxBytes?: number;
    timeout?: number;
    redirects?: number;
    method?: "GET" | "HEAD";
    headers?: Record<string, string>;
    beforeRequest?: (url: string) => Promise<void>;
  } = {},
): Promise<SafeResponse> {
  let target = input;
  for (let hop = 0; hop <= (options.redirects ?? 4); hop++) {
    await options.beforeRequest?.(target);
    const { url, addresses } = await validateTarget(target);
    const pinned = addresses[0];
    const agent = new Agent({
      connect: {
        lookup: ((_host: unknown, opts: unknown, cb: Function) => {
          if ((opts as { all?: boolean })?.all) cb(null, [pinned]);
          else cb(null, pinned.address, pinned.family);
        }) as never,
      },
    });
    try {
      const response = await httpFetch(url, {
        dispatcher: agent,
        redirect: "manual",
        method: options.method ?? "GET",
        headers: { "user-agent": userAgent, ...options.headers },
        signal: AbortSignal.timeout(options.timeout ?? 20000),
      });
      if (response.status === 429) {
        await response.body?.cancel();
        throw new JobError(
          "Public page rate limited (429)",
          "rate_limit",
          undefined,
          retryAfter(response.headers.get("retry-after")),
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect without location");
        target = new URL(location, url).href;
        await response.body?.cancel();
        continue;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      const max = options.maxBytes ?? 3_000_000;
      if (Number(response.headers.get("content-length")) > max) {
        await response.body?.cancel();
        throw new Error("Response exceeds size limit");
      }
      if (response.body)
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > max) {
            await response.body.cancel().catch(() => {});
            throw new Error("Response exceeds size limit");
          }
          chunks.push(Buffer.from(chunk));
        }
      return {
        url: url.href,
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.concat(chunks),
      };
    } finally {
      await agent.close();
    }
  }
  throw new Error("Too many redirects");
}
/** Longest Retry-After a crawl waits out in place; longer ones requeue the job. */
export const maxInlineRateLimitWait = 60_000;
const rateLimitRetries = 3;
export class CrawlSession {
  private robots = new Map<string, ReturnType<typeof robotsParser>>();
  private lastRequest = 0;
  /** Extra spacing for origins that have answered 429 during this crawl. */
  private slowed = new Map<string, number>();
  constructor(
    private sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    private request = safeFetch,
  ) {}
  async allowed(url: string) {
    const origin = new URL(url).origin;
    if (!this.robots.has(origin)) {
      const r = await this.request(`${origin}/robots.txt`, {
        maxBytes: 500000,
      });
      if (
        r.status !== 404 &&
        r.status !== 410 &&
        (r.status < 200 || r.status >= 300)
      )
        throw new Error(
          `Robots rules unavailable (${r.status}); crawling paused`,
        );
      this.robots.set(
        origin,
        robotsParser(
          `${origin}/robots.txt`,
          r.status === 404 || r.status === 410 ? "" : r.body.toString(),
        ),
      );
    }
    return this.robots.get(origin)!.isAllowed(url, userAgent) !== false;
  }
  /** Fetch politely: a 429 slows this origin down and retries before failing. */
  async fetch(url: string, options: Parameters<typeof safeFetch>[1] = {}) {
    for (let retry = 0; ; retry++) {
      try {
        return await this.fetchOnce(url, options);
      } catch (error) {
        if (
          !(error instanceof JobError) ||
          error.code !== "rate_limit" ||
          retry >= rateLimitRetries
        )
          throw error;
        const wait = error.retryAfterMs ?? 10_000 * 2 ** retry;
        if (wait > maxInlineRateLimitWait) throw error;
        const origin = new URL(url).origin;
        this.slowed.set(
          origin,
          Math.min(10_000, Math.max(3_000, (this.slowed.get(origin) ?? 0) * 2)),
        );
        await this.sleep(wait);
      }
    }
  }
  private async fetchOnce(
    url: string,
    options: Parameters<typeof safeFetch>[1] = {},
  ) {
    return this.request(url, {
      ...options,
      beforeRequest: async (target) => {
        if (!(await this.allowed(target)))
          throw new Error(
            `Crawling disallowed by robots.txt: ${new URL(target).pathname}`,
          );
        const rules = this.robots.get(new URL(target).origin)!;
        const delay = Math.max(
          500,
          this.slowed.get(new URL(target).origin) ?? 0,
          (rules.getCrawlDelay(userAgent) ?? 0) * 1000,
        );
        if (delay > 30000)
          throw new Error("Requested crawl delay exceeds worker limit");
        const wait = delay - (Date.now() - this.lastRequest);
        if (wait > 0) await this.sleep(wait);
        this.lastRequest = Date.now();
      },
    });
  }
}
export async function providerJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new JobError(
      `Provider request failed (${response.status})`,
      [401, 403].includes(response.status)
        ? "credentials"
        : response.status === 429
          ? "rate_limit"
          : response.status >= 500 || response.status === 408
            ? "temporary"
            : "permanent",
      providerName(url),
      retryAfter(response.headers.get("retry-after")),
    );
  return response.json();
}
