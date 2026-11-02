import { describe, it, expect } from "vitest";
import { researchEvidence } from "../src/components/research-network-model";
import { previewRun } from "../src/components/research-preview";
const base = Date.parse("2026-10-28T00:00:00Z");
describe("Evidence behind the Scout canvas", () => {
  it("keeps an unloaded run unknown instead of inventing counters or scores", () => {
    const evidence = researchEvidence(null, "audit");
    expect(evidence.counts.map((c) => c.value)).toEqual([null, null, null]);
    expect(evidence.scores).toEqual({});
    expect(evidence.cards).toEqual([]);
  });
  it("uses the latest saved mobile sample and preserves unknown categories", () => {
    const data = previewRun("audit", 5, base);
    data.measurements = [
      {
        strategy: "desktop",
        sample: 3,
        tested_at: new Date(base).toISOString(),
        scores: { performance: 99 },
      },
      {
        strategy: "mobile",
        sample: 2,
        tested_at: new Date(base).toISOString(),
        scores: { performance: 50, seo: 78 },
      },
      {
        strategy: "mobile",
        sample: 1,
        tested_at: new Date(base).toISOString(),
        scores: { performance: 40, seo: 70 },
      },
    ];
    const evidence = researchEvidence(data, "audit");
    expect(evidence.scores).toEqual({ performance: 50, seo: 78 });
    expect(evidence.scoreLabel).toBe("Mobile · sample 2 of 3");
    expect(evidence.counts[0].value).toBe(3);
  });
  it("only shows distinct public evidence URLs, removing query strings", () => {
    const data = previewRun("audit", 11, base);
    data.pages = [
      {
        url: "https://store.example/contact?token=private",
        kind: "contact",
        status_code: 200,
      },
      {
        url: "https://store.example/contact#form",
        kind: "contact",
        status_code: 200,
      },
      { url: "javascript:alert(1)", kind: "unsafe", status_code: null },
    ];
    expect(researchEvidence(data, "audit").cards).toEqual([
      {
        url: "https://store.example/contact",
        kind: "contact",
        label: "/contact",
      },
    ]);
  });
  it("reads actual discovery counters and never fills in missing totals", () => {
    const data = previewRun("discovery", 3, base);
    data.job.payload.funnel = { returned: 20, checked: NaN, queued: -1 };
    expect(
      researchEvidence(data, "discovery").counts.map((c) => c.value),
    ).toEqual([20, null, null]);
    expect(researchEvidence(data, "discovery").cards).toEqual([]);
  });
});
