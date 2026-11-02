import { describe, expect, it } from "vitest";
import {
  evaluateFit,
  summarizeCatalog,
  type CatalogEvidence,
} from "../shared/catalog";
import {
  detectTiming,
  leadScore,
  type LeadScoreInput,
} from "../shared/lead-score";
import {
  queryPerformance,
  rejectionPolicy,
  outsideFitPrefix,
} from "../shared/discovery-search";

const at = Date.parse("2026-11-01T00:00:00Z");
const ago = (days: number) => new Date(at - days * 86400000).toISOString();
const catalog = (over: Partial<CatalogEvidence> = {}): CatalogEvidence => ({
  source_url: "https://shop.example/products.json?limit=250",
  observed_at: ago(0),
  product_count: 40,
  count_capped: false,
  newest_published_at: ago(10),
  last_updated_at: ago(1),
  median_price: 50,
  min_price: 10,
  max_price: 200,
  ...over,
});
const base: LeadScoreInput = {
  findings: [{ kind: "verified", severity: "high", category: "SEO" }],
  performance: 80,
  activity: 85,
  countryVerified: true,
  shopifyVerified: true,
  permissionApproved: true,
  suppressed: false,
};
const part = (input: LeadScoreInput, key: string) =>
  leadScore(input).parts.find((p) => p.key === key)!;

describe("Public catalog", () => {
  it("summarizes a Shopify product feed", () => {
    const summary = summarizeCatalog(
      {
        products: [
          {
            handle: "a",
            published_at: ago(40),
            updated_at: ago(3),
            variants: [{ price: "20.00" }],
          },
          {
            handle: "b",
            published_at: ago(5),
            updated_at: ago(8),
            variants: [{ price: "60.00" }],
          },
          {
            handle: "c",
            published_at: ago(90),
            updated_at: ago(90),
            variants: [{ price: "90.00" }],
          },
        ],
      },
      "https://shop.example/products.json",
    )!;
    expect(summary.product_count).toBe(3);
    expect(summary.count_capped).toBe(false);
    expect(summary.newest_published_at).toBe(ago(5));
    expect(summary.last_updated_at).toBe(ago(3));
    expect([
      summary.min_price,
      summary.median_price,
      summary.max_price,
    ]).toEqual([20, 60, 90]);
  });
  it.each([
    ["not an object", null],
    ["no products", { items: [] }],
    ["wrong product shape", { products: [{ title: "x" }] }],
  ])("rejects %s, so it never counts as Shopify evidence", (_, json) =>
    expect(summarizeCatalog(json, "u")).toBeNull(),
  );
  it("flags a full page as a minimum count", () => {
    const products = Array.from({ length: 250 }, (_, i) => ({
      handle: `p${i}`,
      variants: [],
    }));
    expect(summarizeCatalog({ products }, "u")!.count_capped).toBe(true);
  });
  it("leaves prices unknown when no variant has one", () =>
    expect(
      summarizeCatalog({ products: [{ handle: "a", variants: [] }] }, "u")!
        .median_price,
    ).toBeNull());
});

describe("Ideal client fit", () => {
  it("is not set without limits", () =>
    expect(evaluateFit(catalog(), { min_products: null }).status).toBe(
      "not_set",
    ));
  it("treats a private catalog as unknown, never as a mismatch", () =>
    expect(evaluateFit(null, { min_products: 5 }).status).toBe("unknown"));
  it("accepts a store inside every limit", () =>
    expect(
      evaluateFit(
        catalog(),
        {
          min_products: 10,
          max_products: 100,
          min_price: 20,
          max_price: 90,
          active_within_days: 30,
        },
        at,
      ).status,
    ).toBe("fits"));
  it("reports each reason a store is outside", () => {
    const fit = evaluateFit(
      catalog(),
      { min_products: 100, max_price: 20 },
      at,
    );
    expect(fit.status).toBe("outside");
    expect(fit.reasons).toHaveLength(2);
  });
  it("applies the activity limit only when a date is known", () => {
    expect(
      evaluateFit(
        catalog({ newest_published_at: ago(60) }),
        { active_within_days: 30 },
        at,
      ).status,
    ).toBe("outside");
    expect(
      evaluateFit(
        catalog({ newest_published_at: null }),
        { active_within_days: 30 },
        at,
      ).status,
    ).toBe("fits");
  });
  it("skips price limits when prices are unknown", () =>
    expect(
      evaluateFit(catalog({ median_price: null }), { min_price: 100 }).status,
    ).toBe("fits"));
  it("sets outside stores aside briefly, per country set", () => {
    const policy = rejectionPolicy(`${outsideFitPrefix}: 2 products`, at);
    expect(policy.code).toBe("outside_fit");
    expect(policy.global).toBe(false);
    expect(policy.retryAt).toBe(new Date(at + 7 * 86400000).toISOString());
  });
  it("does not misread a fit reason as a country problem", () =>
    expect(rejectionPolicy(`${outsideFitPrefix}: country store`, at).code).toBe(
      "outside_fit",
    ));
});

describe("Timing signals", () => {
  const kinds = (signals: { kind: string }[]) => signals.map((s) => s.kind);
  it("finds new products on a first audit, and nothing that needs a baseline", () =>
    expect(
      kinds(
        detectTiming(
          { performance: 40, catalog: catalog(), technologies: ["Klaviyo"] },
          null,
          at,
        ),
      ),
    ).toEqual(["new_products"]));
  it("ignores old products", () =>
    expect(
      detectTiming(
        { performance: 40, catalog: catalog({ newest_published_at: ago(45) }) },
        null,
        at,
      ),
    ).toEqual([]));
  it("detects changes since the previous audit", () =>
    expect(
      kinds(
        detectTiming(
          {
            performance: 40,
            catalog: catalog({
              product_count: 60,
              newest_published_at: ago(90),
            }),
            technologies: ["Klaviyo", "Gorgias"],
          },
          {
            performance: 55,
            catalog: catalog({ product_count: 40 }),
            technologies: ["Klaviyo"],
          },
          at,
        ),
      ),
    ).toEqual(["catalog_growth", "score_drop", "new_tool"]));
  it("ignores small changes", () =>
    expect(
      detectTiming(
        {
          performance: 50,
          catalog: catalog({ product_count: 41, newest_published_at: ago(90) }),
          technologies: ["Klaviyo"],
        },
        {
          performance: 55,
          catalog: catalog({ product_count: 40 }),
          technologies: ["Klaviyo"],
        },
        at,
      ),
    ).toEqual([]));
  it("does not call every tool new when no baseline was recorded", () =>
    expect(
      detectTiming(
        { performance: 50, technologies: ["Klaviyo"] },
        { performance: 50 },
        at,
      ),
    ).toEqual([]));
  it("cannot measure growth from a capped baseline", () =>
    expect(
      kinds(
        detectTiming(
          {
            performance: 50,
            catalog: catalog({
              product_count: 250,
              newest_published_at: ago(90),
            }),
          },
          {
            performance: 50,
            catalog: catalog({ product_count: 250, count_capped: true }),
          },
          at,
        ),
      ),
    ).not.toContain("catalog_growth"));
});

describe("Lead score", () => {
  it("separates leads the old yes/no score treated the same", () => {
    const weak = leadScore({
      ...base,
      findings: [{ kind: "verified", severity: "low", category: "SEO" }],
    });
    const strong = leadScore({
      ...base,
      findings: [
        { kind: "verified", severity: "high", category: "SEO" },
        { kind: "verified", severity: "medium", category: "Images" },
      ],
      emails: [{ email: "hello@shop.example" }],
      catalog: catalog(),
      fit: { status: "fits", reasons: [] },
      timing: [{ kind: "score_drop", label: "", evidence: "Fell." }],
    });
    expect(strong.researchScore).toBe(100);
    expect(weak.researchScore).toBeLessThan(40);
  });
  it("gives no opportunity, fit or scope points without a verified finding", () => {
    const input = {
      ...base,
      findings: [
        {
          kind: "hypothesis" as const,
          severity: "high" as const,
          category: "CRO",
        },
      ],
    };
    for (const key of ["verified_opportunity", "service_fit", "feasible_scope"])
      expect(part(input, key).points).toBe(0);
    expect(leadScore(input).priority).toBe(0);
  });
  it("counts slow mobile with a finding as a full opportunity", () =>
    expect(
      part(
        {
          ...base,
          performance: 30,
          findings: [{ kind: "verified", severity: "low", category: "SEO" }],
        },
        "verified_opportunity",
      ).points,
    ).toBe(25));
  it("grades contact routes by what is published", () => {
    const contact = (over: Partial<LeadScoreInput>) =>
      part({ ...base, ...over }, "contact").points;
    expect(contact({ emails: [{ email: "info@x.example" }] })).toBe(10);
    expect(contact({ emails: [{ email: "support@x.example" }] })).toBe(7);
    expect(contact({ contact_url: "https://x.example/contact" })).toBe(5);
    expect(contact({ emails: [{ email: "careers@x.example" }] })).toBe(0);
    expect(contact({})).toBe(0);
  });
  it("lowers fit for stores outside the ideal client, without hiding them", () => {
    const outside = part(
      { ...base, fit: { status: "outside", reasons: ["too small"] } },
      "service_fit",
    );
    expect(outside.points).toBe(5);
    expect(outside.reason).toContain("too small");
  });
  it("uses catalog dates for activity when known", () => {
    const activity = (newest: string) =>
      part(
        { ...base, catalog: catalog({ newest_published_at: newest }) },
        "activity",
      ).points;
    expect(activity(new Date().toISOString())).toBe(10);
    expect(activity(new Date(Date.now() - 400 * 86400000).toISOString())).toBe(
      3,
    );
  });
  it("adds to timing for each extra signal, capped at the maximum", () => {
    const signal = (kind: "new_products" | "new_tool" | "score_drop") => ({
      kind,
      label: "",
      evidence: "x",
    });
    expect(
      part({ ...base, timing: [signal("new_products")] }, "timing").points,
    ).toBe(10);
    expect(
      part(
        { ...base, timing: [signal("new_tool"), signal("new_products")] },
        "timing",
      ).points,
    ).toBe(18);
    expect(
      part(
        { ...base, timing: [signal("score_drop"), signal("new_tool")] },
        "timing",
      ).points,
    ).toBe(20);
  });
  it("explains every point and keeps the existing gates", () => {
    const result = leadScore({ ...base, permissionApproved: false });
    expect(result.priority).toBe(0);
    expect(result.researchScore).toBeGreaterThan(0);
    expect(result.parts.reduce((sum, p) => sum + p.max, 0)).toBe(100);
    expect(result.parts.reduce((sum, p) => sum + p.points, 0)).toBe(
      result.researchScore,
    );
    expect(result.parts.every((p) => p.reason.length > 0)).toBe(true);
  });
});

describe("Search learning from real outcomes", () => {
  const row = (keyword: string, over = {}) => ({
    keyword,
    country: "US",
    industry: "Beauty",
    credits: 1,
    completed_audits: 2,
    suitable_contacts: 1,
    queued: 2,
    ...over,
  });
  it("ranks a query that won a client above a busier one", () =>
    expect(
      queryPerformance([
        row("busy", { completed_audits: 5, suitable_contacts: 3 }),
        row("winner", { won_leads: 1 }),
      ])[0].keyword,
    ).toBe("winner"));
  it("ranks a query down for stores marked not a fit, never below zero", () => {
    const [good, bad] = queryPerformance([
      row("good"),
      row("bad", { not_fit_leads: 5 }),
    ]);
    expect(good.keyword).toBe("good");
    expect(bad.yield).toBe(0);
  });
  it("still works on rows from before outcomes existed", () =>
    expect(queryPerformance([row("old")])[0].yield).toBe(4));
});
