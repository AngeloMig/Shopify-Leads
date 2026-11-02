import * as cheerio from "cheerio";
import { CrawlSession, type SafeResponse } from "../lib/network.js";
import { inspectHtml, type PageEvidence } from "./html-audit.js";
import { JobError } from "../lib/job-errors.js";

/** Follow published contact/help routes; never guess mailboxes or URL paths. */
export function contactPageLinks(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl).hostname.replace(/^www\./, "");
  const ranked = new Map<string, number>();
  $("a[href]").each((_, element) => {
    try {
      const link = $(element);
      const url = new URL(link.attr("href")!, pageUrl);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password)
        return;
      const host = url.hostname.replace(/^www\./, "");
      const own = host === base || host.endsWith(`.${base}`);
      const helpProvider =
        /\.(zendesk|gorgias|freshdesk|helpscoutdocs)\.com$/.test(host);
      const text = link.text().trim();
      if (
        !own &&
        !(helpProvider && /contact|help|support|customer/i.test(text))
      )
        return;
      const path = decodeURIComponent(url.pathname);
      if (
        /\/(products|collections|blogs|search|account|cart)(\/|$)/i.test(path)
      )
        return;
      const score = /contact|customer[-_ ]?(?:care|service)/i.test(
        `${path} ${text}`,
      )
        ? 0
        : /help|support|faq/i.test(`${path} ${text}`)
          ? 1
          : /about[-_ ]?us|about$/i.test(`${path} ${text}`)
            ? 2
            : /refund|returns(?:[-/ ]|$)/i.test(`${path} ${text}`)
              ? 3
              : -1;
      if (score < 0 || /cdn-cgi|privacy|terms|login|sign[- ]?in/i.test(path))
        return;
      url.hash = "";
      url.search = "";
      ranked.set(url.href, Math.min(score, ranked.get(url.href) ?? score));
    } catch {
      /* Ignore malformed links. */
    }
  });
  return [...ranked].sort((a, b) => a[1] - b[1]).map(([url]) => url);
}

export async function scanContactPages(
  crawl: Pick<CrawlSession, "fetch">,
  home: SafeResponse,
  options: {
    knownContactUrl?: string | null;
    scannedPages?: PageEvidence[];
    excludedUrls?: string[];
    onActivity?: (
      url: string,
      state: "waiting" | "completed" | "skipped",
      message: string,
      facts?: Record<string, string | number>,
    ) => Promise<void>;
    checkpoint?: () => Promise<void>;
  } = {},
) {
  const pages: (PageEvidence & { http_status: number })[] = [];
  const errors: { url: string; message: string }[] = [];
  const seen = new Set([
    home.url,
    ...(options.scannedPages ?? []).map((p) => p.url),
    ...(options.excludedUrls ?? []),
  ]);
  const queue = contactPageLinks(home.body.toString(), home.url).map((url) => ({
    url,
    depth: 1,
  }));
  if (options.knownContactUrl && /^https?:\/\//.test(options.knownContactUrl))
    queue.unshift({ url: options.knownContactUrl, depth: 1 });
  let attempts = 0;
  while (queue.length && attempts < 5) {
    const next = queue.shift()!;
    if (seen.has(next.url)) continue;
    seen.add(next.url);
    attempts++;
    await options.checkpoint?.();
    await options.onActivity?.(
      next.url,
      "waiting",
      "Reading a published contact route",
    );
    let activityFailure = false;
    try {
      const response = await crawl.fetch(next.url);
      await options.checkpoint?.();
      if (
        response.status >= 400 ||
        !response.headers["content-type"]?.includes("text/html")
      )
        throw new Error(`Contact page unavailable (${response.status})`);
      const page = inspectHtml(
        response.body.toString(),
        response.url,
        "contact",
      );
      seen.add(response.url);
      pages.push({ ...page, http_status: response.status });
      activityFailure = true;
      await options.onActivity?.(
        next.url,
        "completed",
        "Public contact page reviewed",
        { emails: page.emails.length, status_code: response.status },
      );
      activityFailure = false;
      if (page.emails.length) break;
      if (next.depth < 2)
        queue.push(
          ...contactPageLinks(response.body.toString(), response.url).map(
            (url) => ({ url, depth: 2 }),
          ),
        );
    } catch (e) {
      if (activityFailure) throw e;
      if (
        e instanceof JobError &&
        [
          "lease_lost",
          "rate_limit",
          "budget",
          "credentials",
          "provider_paused",
        ].includes(e.code)
      )
        throw e;
      if (
        e instanceof Error &&
        /Worker lease lost|job is not running/i.test(e.message)
      )
        throw e;
      await options.onActivity?.(
        next.url,
        "skipped",
        e instanceof Error ? e.message : "Contact page unavailable",
      );
      errors.push({
        url: next.url,
        message: e instanceof Error ? e.message : "Contact page failed",
      });
    }
  }
  return { pages, errors, attempted: attempts };
}
