import { describe, it, expect } from "vitest";
import { compareAudits, formatValue } from "../shared/before-after";
import { createBeforeAfterReport } from "../server/modules/before-after-report";
import { emptySender } from "../shared/sender";
import type { Finding, PsiSample } from "../shared/types";

const runs = (performance: number, lcp: number): PsiSample[] =>
  (["mobile", "desktop"] as const).flatMap((strategy) =>
    [1, 2, 3].map((sample) => ({
      url: "https://store.example/",
      strategy,
      sample,
      tested_at: "2026-10-01T00:00:00Z",
      environment: {
        lighthouse_version: "12.0.0",
        form_factor: strategy,
        throttling_method: "simulate",
      },
      scores: { performance: performance + sample - 2, seo: 90 },
      diagnostics: { "largest-contentful-paint": { numericValue: lcp } },
      field_data: { available: false, scope: "unavailable", metrics: {} },
    })),
  );
const finding = (title: string, category = "Performance"): Finding => ({
  id: title,
  category,
  url: "https://store.example/",
  title,
  evidence: "Lighthouse mobile",
  severity: "high",
  confidence: "high",
  recommendation: "Fix it",
  kind: "verified",
});

describe("Before and after", () => {
  const before = {
    tested_at: "2026-10-01T00:00:00Z",
    samples: runs(38, 6200),
    findings: [
      finding("Reduce unused JavaScript"),
      finding("Image elements do not have explicit width and height"),
    ],
  };
  const after = {
    tested_at: "2026-11-01T00:00:00Z",
    samples: runs(71, 2900),
    findings: [
      finding("Image elements do not have explicit width and height"),
      finding("Serve images in modern formats"),
    ],
  };
  it("compares medians and marks which way each one moved", () => {
    const result = compareAudits(before, after);
    const perf = result.rows.find((r) => r.label === "Mobile performance")!;
    expect([perf.before, perf.after, perf.better]).toEqual([38, 71, true]);
    const lcp = result.rows.find((r) => r.label.startsWith("Largest"))!;
    expect(lcp.better).toBe(true);
    expect(
      result.rows.find((r) => r.label === "Mobile SEO")!.better,
    ).toBeNull();
    expect(result.measured).toBe(true);
  });
  it("sorts findings into fixed, still open and new", () => {
    const result = compareAudits(before, after);
    expect(result.fixed.map((f) => f.title)).toEqual([
      "Reduce unused JavaScript",
    ]);
    expect(result.open).toHaveLength(1);
    expect(result.added.map((f) => f.title)).toEqual([
      "Serve images in modern formats",
    ]);
  });
  it("never compares an audit without three comparable runs", () => {
    const result = compareAudits({ ...before, samples: [] }, after);
    expect(result.rows.every((r) => r.better === null)).toBe(true);
    expect(result.measured).toBe(false);
    expect(formatValue(null, "score")).toBe("Not measured");
  });
  it("renders a PDF", async () => {
    const pdf = await createBeforeAfterReport({
      name: "Store",
      domain: "store.example",
      sender: { ...emptySender, name: "Grant", email: "grant@studio.example" },
      agency: "Studio",
      before,
      after,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
