import { describe, it, expect, vi } from "vitest";
import { CrawlSession, type SafeResponse } from "../server/lib/network";
import { JobError } from "../server/lib/job-errors";

const ok = (url: string): SafeResponse => ({
  url,
  status: 200,
  headers: { "content-type": "text/html" },
  body: Buffer.from("<title>Page</title>"),
});
const limited = (retryAfterMs?: number) =>
  new JobError(
    "Public page rate limited (429)",
    "rate_limit",
    undefined,
    retryAfterMs,
  );

/** A fake site: robots.txt is open, and `limits` 429s come before success. */
function site(limits: (number | undefined)[]) {
  const pages: string[] = [];
  const request = vi.fn(
    async (
      url: string,
      options: { beforeRequest?: (u: string) => Promise<void> } = {},
    ) => {
      if (url.endsWith("/robots.txt"))
        return { ...ok(url), status: 404, body: Buffer.from("") };
      await options.beforeRequest?.(url);
      pages.push(url);
      if (limits.length) throw limited(limits.shift());
      return ok(url);
    },
  );
  const sleep = vi.fn(async (_ms: number) => {});
  return {
    pages,
    sleep,
    crawl: new CrawlSession(sleep, request as never),
  };
}

describe("Crawl rate limits", () => {
  it("waits out a 429 and retries the same page", async () => {
    const { crawl, pages, sleep } = site([undefined, 5000]);
    const page = await crawl.fetch("https://store.example/products/a");
    expect(page.status).toBe(200);
    expect(pages).toHaveLength(3);
    // Backoff without Retry-After, then the site's own Retry-After.
    const waits = sleep.mock.calls.map(([ms]) => ms);
    expect(waits).toContain(10_000);
    expect(waits).toContain(5000);
  });

  it("slows later requests to a site that rate limited", async () => {
    const { crawl, sleep } = site([undefined]);
    await crawl.fetch("https://store.example/a");
    sleep.mockClear();
    await crawl.fetch("https://store.example/b");
    // The usual 500 ms spacing is raised to at least 3 seconds.
    expect(Math.max(...sleep.mock.calls.map(([ms]) => ms))).toBeGreaterThan(
      2000,
    );
  });

  it("gives up after three retries", async () => {
    const { crawl, pages } = site([1000, 1000, 1000, 1000]);
    await expect(crawl.fetch("https://store.example/a")).rejects.toMatchObject({
      code: "rate_limit",
    });
    expect(pages).toHaveLength(4);
  });

  it("requeues instead of waiting out a long Retry-After", async () => {
    const { crawl, pages, sleep } = site([120_000]);
    await expect(crawl.fetch("https://store.example/a")).rejects.toMatchObject({
      code: "rate_limit",
    });
    expect(pages).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalledWith(120_000);
  });
});
