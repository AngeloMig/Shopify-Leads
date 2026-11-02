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
  it("propagates rate limits, server outages and lease loss", async () => {
    const rate = new JobError(
      "Public page rate limited (429)",
      "rate_limit",
      undefined,
      60000,
    );
    await expect(
      scanRepresentativePages(
        {
          fetch: async () => {
            throw rate;
          },
        },
        home,
        { checkpoint: async () => {} },
      ),
    ).rejects.toBe(rate);
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
