import { describe, it, expect, vi } from "vitest";
import { JobError } from "../server/lib/job-errors";
import {
  contactPageLinks,
  scanContactPages,
} from "../server/modules/contact-audit";
const response = (url: string, html: string, status = 200) => ({
  url,
  body: Buffer.from(html),
  status,
  headers: { "content-type": "text/html" },
});
describe("Public contact page traversal", () => {
  it("keeps cancellation and rate limits fatal during optional contact recovery", async () => {
    const fetch = vi.fn(async () => {
      throw new JobError("Rate limited", "rate_limit");
    });
    const home = response(
      "https://store.example/",
      '<a href="/contact">Contact</a>',
    );
    await expect(
      scanContactPages({ fetch }, home, {
        checkpoint: async () => {
          throw new Error("Worker lease lost");
        },
      }),
    ).rejects.toThrow("lease lost");
    expect(fetch).not.toHaveBeenCalled();
    await expect(scanContactPages({ fetch }, home)).rejects.toMatchObject({
      code: "rate_limit",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("prioritizes contact pages and follows explicitly linked support centers", () => {
    expect(
      contactPageLinks(
        `<a href="/pages/about-us">About us</a><a href="https://merchant.zendesk.com/hc/en-us">Help center</a><a href="/pages/customer-care">Customer care</a><a href="https://unrelated.com/contact">Contact</a><a href="/products/contact-lenses">Contact lenses</a>`,
        "https://merchant.com/",
      ),
    ).toEqual([
      "https://merchant.com/pages/customer-care",
      "https://merchant.zendesk.com/hc/en-us",
      "https://merchant.com/pages/about-us",
    ]);
  });
  it("reaches a linked contact page through help without guessing addresses", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/help")
        ? response(url, '<a href="/contact">Contact us</a>')
        : response(url, '<a href="mailto:care@parent-brand.com">Email us</a>'),
    );
    const result = await scanContactPages(
      { fetch },
      response("https://merchant.com/", '<a href="/help">Help</a>'),
    );
    expect(result.pages.flatMap((p) => p.emails)).toEqual([
      {
        email: "care@parent-brand.com",
        source_url: "https://merchant.com/contact",
      },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("preserves partial results and reports blocked pages, with a five-page bound", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("Crawling disallowed by robots.txt");
    });
    const html = Array.from(
      { length: 10 },
      (_, i) => `<a href="/contact-${i}">Contact</a>`,
    ).join("");
    const result = await scanContactPages(
      { fetch },
      response("https://merchant.com/", html),
    );
    expect(result.attempted).toBe(5);
    expect(result.errors).toHaveLength(5);
    expect(result.pages).toEqual([]);
  });
});
