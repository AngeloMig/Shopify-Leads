import { describe, it, expect, vi } from "vitest";
import { scanRepresentativePages } from "../server/modules/representative-pages";
import { inspectHtml } from "../server/modules/html-audit";
import { JobError } from "../server/lib/job-errors";
const home = inspectHtml(
  `<a href="/products/old">Old</a><a href="/products/current">Current</a><a href="/pages/contact">Contact</a><a href="/pages/about">About</a>`,
  "https://store.example/",
);
const response = (url: string, status = 200) => ({
  url,
  status,
  body: Buffer.from("<title>Store page</title>"),
  headers: { "content-type": "text/html" },
});
describe("Optional representative page failures", () => {
  it("recovers from a stale product link and a robots-blocked contact page without blocking the audit", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/contact"))
        throw new Error("Crawling disallowed by robots.txt: /pages/contact");
      return response(url, url.endsWith("/old") ? 404 : 200);
    });
    const skipped = vi.fn(async () => {});
    const completed = vi.fn(async () => {});
    const result = await scanRepresentativePages({ fetch }, home, {
      checkpoint: async () => {},
      onSkipped: skipped,
      onComplete: completed,
    });
    expect(result.pages.map((p) => p.kind)).toEqual(["product", "about"]);
    expect(result.pages[0].url).toBe("https://store.example/products/current");
    expect(result.skipped.map((p) => p.kind)).toEqual(["product", "contact"]);
    expect(skipped).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledWith(
      expect.objectContaining({
        requested_url: "https://store.example/products/current",
        http_status: 200,
        kind: "product",
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("skips the remaining pages once the site keeps rate limiting", async () => {
    const fetch = vi.fn(async () => {
      throw new JobError("Public page rate limited (429)", "rate_limit");
    });
    const result = await scanRepresentativePages({ fetch }, home, {
      checkpoint: async () => {},
    });
    expect(result.rateLimited).toBe(true);
    expect(result.pages).toEqual([]);
    expect(result.skipped.map((p) => p.kind)).toEqual([
      "product",
      "contact",
      "about",
    ]);
    expect(result.skipped[0].reason).toMatch(/429/);
    expect(result.skipped[1].reason).toMatch(/rate limiting/);
    // Only the first page is requested; the rest are not attempted.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("propagates server outages and lease loss", async () => {
    await expect(
      scanRepresentativePages(
        { fetch: async (url) => response(url, 503) },
        home,
        { checkpoint: async () => {} },
      ),
    ).rejects.toMatchObject({ code: "temporary" });
    const fetch = vi.fn(async (url) => response(url));
    await expect(
      scanRepresentativePages({ fetch }, home, {
        checkpoint: async () => {
          throw new Error("Worker lease lost");
        },
      }),
    ).rejects.toThrow("lease lost");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not hide activity persistence failures as optional page failures", async () => {
    await expect(
      scanRepresentativePages(
        { fetch: async (url) => response(url, 404) },
        home,
        {
          checkpoint: async () => {},
          onSkipped: async () => {
            throw new Error("Database unavailable");
          },
        },
      ),
    ).rejects.toThrow("Database unavailable");
  });
});
