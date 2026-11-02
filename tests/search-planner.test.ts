import { describe, it, expect } from "vitest";
import {
  planSearch,
  queryPerformance,
  rejectionPolicy,
  storefrontPriority,
  tavilyExclusions,
  searchFormats,
} from "../shared/discovery-search";
import { defaultSettings } from "../shared/types";
const config = {
  ...defaultSettings,
  countries: ["AU"] as ["AU"],
  industries: ["Beauty & skincare"],
  keywords: "facial serums, natural skincare",
  keyword_library: false,
};
describe("Search planning and bounded exclusions", () => {
  it("explores all six formats without losing keyword or country coverage", () => {
    const plans = Array.from({ length: 24 }, (_, i) => planSearch(config, i));
    for (const keyword of ["facial serums", "natural skincare"])
      expect(
        new Set(
          plans.filter((p) => p.keyword === keyword).map((p) => p.format),
        ),
      ).toEqual(new Set(searchFormats));
    expect(
      plans.some((p) =>
        /Sydney|Melbourne|Brisbane|Perth|Adelaide/.test(p.query),
      ),
    ).toBe(true);
    expect(planSearch({ ...config, countries: ["US", "GB"] }, 0).country).toBe(
      "US",
    );
    expect(planSearch({ ...config, countries: ["US", "GB"] }, 1).country).toBe(
      "GB",
    );
  });
  it("uses publication and contact yield only on the exploitation turn", () => {
    const data = [
      {
        keyword: "facial serums",
        country: "AU",
        industry: "Beauty & skincare",
        format: "online-shop",
        credits: 1,
        completed_audits: 1,
        suitable_contacts: 1,
        queued: 1,
      },
    ];
    expect(planSearch(config, 3, data)).toMatchObject({
      keyword: "facial serums",
      format: "online-shop",
      mode: "productive",
    });
    expect(planSearch(config, 2, data).mode).toBe("explore");
    expect(
      planSearch({ ...config, adaptive_queries: false }, 3, data).mode,
    ).toBe("explore");
    expect(
      planSearch(config, 3, [
        { ...data[0], completed_audits: 0, suitable_contacts: 0, queued: 20 },
      ]).mode,
    ).toBe("explore");
    expect(queryPerformance(data)[0].yield).toBe(3);
  });
  it("caps combined exclusions at 150, deduplicates and preserves manual exclusions first", () => {
    const result = tavilyExclusions(
      ["manual.example", "MANUAL.EXAMPLE"],
      ["platform.example"],
      Array.from({ length: 200 }, (_, i) => `old${i}.example`),
    );
    expect(result).toHaveLength(150);
    expect(new Set(result).size).toBe(150);
    expect(result.slice(0, 2)).toEqual(["manual.example", "platform.example"]);
  });
  it("prioritizes product results without discarding merchant blog candidates", () => {
    expect(
      storefrontPriority(
        "https://store.example/products/serum",
        "Shop serums",
        "Shipping available",
        0.7,
      ),
    ).toBeGreaterThan(
      storefrontPriority(
        "https://publisher.example/top-stores",
        "Top 10 brands",
        "Directory",
        0.99,
      ),
    );
  });
  it("uses reason-specific cooldowns and scopes country rejections to campaign targets", () => {
    const time = Date.parse("2026-10-28T00:00Z");
    expect(rejectionPolicy("Robots rules unavailable (503)", time).code).toBe(
      "temporary",
    );
    expect(rejectionPolicy("Storefront returned HTTP 503", time)).toMatchObject(
      { code: "temporary", global: true, retryAt: "2026-10-29T00:00:00.000Z" },
    );
    expect(rejectionPolicy("Robots rules unavailable (403)", time).code).toBe(
      "crawl_blocked",
    );
    expect(
      rejectionPolicy("Target country unverified or excluded", time).global,
    ).toBe(false);
    expect(rejectionPolicy("Shopify evidence insufficient", time).retryAt).toBe(
      "2026-11-27T00:00:00.000Z",
    );
  });
});
