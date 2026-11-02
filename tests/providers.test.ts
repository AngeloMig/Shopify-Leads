import { afterEach, describe, it, expect, vi } from "vitest";
import { defaultSettings } from "../shared/types";
vi.mock("../server/lib/network", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/network")>()),
  validateTarget: vi.fn().mockResolvedValue({}),
}));
import { discover, pageSpeed } from "../server/modules/providers";
import {
  discoverySourceChanged,
  settingsSchema,
} from "../server/lib/validation";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Tavily discovery (fixtures, no live calls)", () => {
  const config = {
    ...defaultSettings,
    provider: "tavily" as const,
    countries: ["US", "GB"] as ("US" | "GB")[],
    industries: ["Home & furniture"],
    batch_size: 50,
  };
  it("supports Tavily settings and refuses missing credentials before charging", async () => {
    expect(settingsSchema.parse(config).provider).toBe("tavily");
    vi.stubEnv("TAVILY_API_KEY", "");
    const charge = vi.fn(),
      fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(discover(config, charge)).rejects.toThrow("TAVILY_API_KEY");
    expect(charge).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves search rotation when only screening or schedule settings change", () => {
    expect(
      discoverySourceChanged(config, {
        ...config,
        mobile_threshold: 100,
        seo_threshold: 100,
        modernization_threshold: 100,
        enabled: true,
        batch_size: 1,
      }),
    ).toBe(false);
    expect(
      discoverySourceChanged(config, { ...config, keywords: "oak furniture" }),
    ).toBe(true);
    expect(
      discoverySourceChanged(config, { ...config, provider: "brave" }),
    ).toBe(true);
  });
  it("uses one basic search with fixed cost options, deduplicates domains and leaves country unverified", async () => {
    vi.stubEnv("TAVILY_API_KEY", "fixture-tavily-key");
    const fetch = vi.fn().mockResolvedValue(
      response({
        results: [
          {
            url: "https://www.merchant.com/products/lamp",
            title: "Merchant",
          },
          { url: "https://merchant.com", title: "Merchant homepage" },
          { url: "javascript:invalid", title: "Bad" },
          { title: "Missing URL" },
          null,
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const charge = vi.fn();
    const result = await discover(config, charge);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledExactlyOnceWith("tavily");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.headers.Authorization).toBe("Bearer fixture-tavily-key");
    expect(JSON.parse(init.body)).toMatchObject({
      search_depth: "basic",
      auto_parameters: false,
      max_results: 20,
      include_answer: false,
      include_raw_content: false,
      country: "united states",
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      domain: "merchant.com",
      country: null,
      country_evidence: null,
      industry: "Unknown",
      source_provider: "tavily",
    });
  });
  it("rotates country queries and excludes only explicitly processed domains", async () => {
    vi.stubEnv("TAVILY_API_KEY", "fixture-tavily-key");
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          response({ results: [{ url: "https://merchant.com" }] }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const first = await discover(config, vi.fn());
    const second = await discover(config, vi.fn(), first.nextCursor, [], {
      processed: ["merchant.com"],
    });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      country: "united kingdom",
      exclude_domains: expect.arrayContaining(["merchant.com", "shopify.com"]),
    });
    expect(second.candidates).toEqual([]);
  });
  it("surfaces exhausted quota and malformed provider responses", async () => {
    vi.stubEnv("TAVILY_API_KEY", "fixture-tavily-key");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 432 }))
      .mockResolvedValueOnce(response({ unexpected: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(discover(config, vi.fn())).rejects.toThrow("432");
    await expect(discover(config, vi.fn())).rejects.toThrow(
      "Unexpected Tavily response",
    );
  });
  it("keeps merchant blog hits for homepage verification and excludes platform pages", async () => {
    vi.stubEnv("TAVILY_API_KEY", "fixture-key");
    const fetch = vi.fn().mockResolvedValue(
      response({
        results: [
          { url: "https://shopify.com/blog/stores" },
          { url: "https://analyzify.com" },
          { url: "https://merchant.com/blogs/news" },
          { url: "https://first-store.com/products/sofa" },
          { url: "https://second-store.com/collections/tables" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await discover({ ...config, batch_size: 1 }, vi.fn());
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_results).toBe(20);
    expect(result.candidates.map((c) => c.domain)).toEqual([
      "first-store.com",
      "second-store.com",
      "merchant.com",
    ]);
    expect(result.summary).toMatchObject({
      returned: 5,
      excluded: 2,
      candidates: 3,
    });
  });
  it("migrates legacy rotation without retaining unchecked-domain exclusions", async () => {
    vi.stubEnv("TAVILY_API_KEY", "fixture-key");
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(response({ results: [] })));
    vi.stubGlobal("fetch", fetch);
    let cursor = JSON.stringify({
      v: 1,
      query: 0,
      excluded: ["old-store.com"],
    });
    const queries: string[] = [];
    for (let index = 0; index < 5; index++) {
      const result = await discover(config, vi.fn(), cursor);
      cursor = result.nextCursor!;
      queries.push(result.summary!.query);
    }
    expect(queries[0]).toContain("online shop");
    expect(queries[0]).not.toContain("Shopify");
    expect(queries[1]).toContain("Shopify");
    expect(
      queries.some((query) => query.includes('"powered by Shopify"')),
    ).toBe(true);
    expect(
      queries.some((query) => query.includes("solid wood furniture")),
    ).toBe(true);
    expect(
      JSON.parse(fetch.mock.calls[0][1].body).exclude_domains,
    ).not.toContain("old-store.com");
    expect(JSON.parse(cursor)).toMatchObject({ v: 3, step: 5 });
  });
});
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
describe("Provider adapters using explicit test fixtures (no live API calls)", () => {
  it("calls Store Leads with documented OR filters, credentials, cursor and canonical deduplication", async () => {
    vi.stubEnv("STORE_LEADS_API_KEY", "fixture-key");
    const fetch = vi.fn().mockResolvedValue(
      response({
        next_cursor: "next-page",
        domains: [
          {
            name: "www.merchant.com",
            merchant_name: "Merchant",
            country_code: "CA",
            categories: ["/Apparel"],
          },
          { name: "merchant.com", country_code: "CA" },
          { name: "javascript:invalid" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const charge = vi.fn();
    const result = await discover(defaultSettings, charge, "old-page");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].domain).toBe("merchant.com");
    expect(result.candidates[0].country).toBe("CA");
    expect(result.nextCursor).toBe("next-page");
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get("f:cc:op")).toBe("or");
    expect(url.searchParams.get("f:cat:op")).toBe("or");
    expect(url.searchParams.get("cursor")).toBe("old-page");
    expect(charge).toHaveBeenCalledWith("storeleads");
  });
  it("never equates Brave search localization with verified business country", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "fixture-key");
    vi.stubEnv("BRAVE_STORAGE_ALLOWED", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          web: {
            results: [
              { title: "Sample business", url: "https://merchant.com" },
            ],
          },
        }),
      ),
    );
    const result = await discover(
      { ...defaultSettings, provider: "brave", countries: ["US"] },
      vi.fn(),
    );
    expect(result.candidates[0].country).toBeNull();
    expect(result.candidates[0].country_evidence).toBeNull();
  });
  it("labels absent field data unavailable and preserves lab TBT separately", async () => {
    vi.stubEnv("PAGESPEED_API_KEY", "fixture-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          lighthouseResult: {
            fetchTime: "2026-10-27T00:00:00Z",
            categories: {
              performance: { score: 0.42 },
              seo: { score: 0.78 },
            },
            audits: { "total-blocking-time": { numericValue: 200 } },
          },
        }),
      ),
    );
    const sample = await pageSpeed(
      "https://merchant.com",
      "mobile",
      1,
      vi.fn(),
    );
    expect(sample.scores.performance).toBe(42);
    expect(sample.scores.accessibility).toBeNull();
    expect(sample.field_data).toEqual({
      available: false,
      scope: "unavailable",
      metrics: {},
    });
    expect(sample.field_data.metrics).not.toHaveProperty("INP");
  });
  it("records origin-scoped field INP without substituting a lab metric", async () => {
    vi.stubEnv("PAGESPEED_API_KEY", "fixture-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          lighthouseResult: { categories: { performance: { score: 0.9 } } },
          originLoadingExperience: {
            metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 180 } },
          },
        }),
      ),
    );
    const sample = await pageSpeed(
      "https://merchant.com",
      "desktop",
      2,
      vi.fn(),
    );
    expect(sample.field_data.scope).toBe("origin");
    expect(sample.field_data.metrics.INTERACTION_TO_NEXT_PAINT).toEqual({
      percentile: 180,
    });
  });
  it("surfaces provider failures instead of creating simulated findings", async () => {
    vi.stubEnv("PAGESPEED_API_KEY", "fixture-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 429 })),
    );
    await expect(
      pageSpeed("https://merchant.com", "mobile", 1, vi.fn()),
    ).rejects.toThrow("429");
  });
});

it("does not call Brave when storage rights have not been configured", async () => {
  vi.stubEnv("BRAVE_SEARCH_API_KEY", "fixture-key");
  vi.stubEnv("BRAVE_STORAGE_ALLOWED", "false");
  const charge = vi.fn();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    discover(
      { ...defaultSettings, provider: "brave", countries: ["US"] },
      charge,
    ),
  ).rejects.toThrow("storage rights");
  expect(charge).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
