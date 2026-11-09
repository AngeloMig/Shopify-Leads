import { describe, expect, it } from "vitest";
import { detectTiming } from "../shared/lead-score";
import { summarizeCatalog, type CatalogEvidence } from "../shared/catalog";

const at = Date.parse("2026-11-10T00:00:00Z");
const daysAgo = (n: number) => new Date(at - n * 86400000).toISOString();
const catalog = (patch: Partial<CatalogEvidence>): CatalogEvidence => ({
  source_url: "https://shop.example/products.json",
  observed_at: daysAgo(0),
  product_count: 12,
  count_capped: false,
  newest_published_at: daysAgo(3),
  oldest_published_at: daysAgo(40),
  last_updated_at: daysAgo(1),
  median_price: 40,
  min_price: 10,
  max_price: 90,
  ...patch,
});
const kinds = (s: { kind: string }[]) => s.map((x) => x.kind);

describe("Buying signals", () => {
  it("flags a store that pays for ads, naming the tags", () => {
    const s = detectTiming(
      {
        performance: 40,
        technologies: ["Klaviyo", "Meta Pixel", "Google Ads"],
      },
      null,
      at,
    );
    const ads = s.find((x) => x.kind === "paid_ads")!;
    expect(ads.evidence).toMatch(/Meta Pixel and Google Ads tags/);
  });
  it("flags a new store only when the whole catalog was read", () => {
    expect(
      kinds(detectTiming({ performance: 40, catalog: catalog({}) }, null, at)),
    ).toContain("new_store");
    expect(
      kinds(
        detectTiming(
          { performance: 40, catalog: catalog({ count_capped: true }) },
          null,
          at,
        ),
      ),
    ).not.toContain("new_store");
    expect(
      kinds(
        detectTiming(
          {
            performance: 40,
            catalog: catalog({ oldest_published_at: daysAgo(400) }),
          },
          null,
          at,
        ),
      ),
    ).not.toContain("new_store");
    expect(
      kinds(
        detectTiming(
          { performance: 40, catalog: catalog({ product_count: 2 }) },
          null,
          at,
        ),
      ),
    ).not.toContain("new_store");
  });
  it("doesn't call ad tags a new tool just because older audits missed them", () => {
    const s = detectTiming(
      { performance: 40, technologies: ["Klaviyo", "Google Ads"] },
      { performance: 40, technologies: ["Klaviyo"] },
      at,
    );
    expect(kinds(s)).toEqual(["paid_ads"]);
  });
  it("reads the oldest product from the feed", () => {
    const feed = {
      products: [
        { handle: "a", variants: [{ price: "10" }], published_at: daysAgo(5) },
        { handle: "b", variants: [{ price: "20" }], published_at: daysAgo(50) },
      ],
    };
    expect(
      summarizeCatalog(feed, "https://shop.example/products.json")
        ?.oldest_published_at,
    ).toBe(daysAgo(50));
  });
});
