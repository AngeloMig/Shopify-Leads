import { describe, expect, it } from "vitest";
import { comparableRuns, reportIssues } from "../server/modules/report-data";
import type { Finding } from "../shared/types";
import type { PsiSample } from "../server/modules/providers";
import { lighthouseIdentity } from "../shared/audit-presentation";
const run = (strategy: "mobile" | "desktop", sample = 1): PsiSample => ({
  url: "https://merchant.com/",
  strategy,
  sample,
  tested_at: "2026-10-27T00:00:00Z",
  scores: { performance: 60, seo: 100 },
  environment: {
    lighthouse_version: "13.5.0",
    form_factor: strategy,
    throttling_method: null,
  },
  diagnostics: {
    "largest-contentful-paint": { numericValue: 3000 },
    "unused-javascript": {
      title: "Reduce unused JavaScript",
      details: {
        overallSavingsBytes: 120000,
        overallSavingsMs: 150,
        items: [
          { url: "https://cdn.merchant.com/script.js", wastedBytes: 120000 },
        ],
      },
    },
  },
  field_data: { available: false, scope: "unavailable", metrics: {} },
});
const finding = (strategy: string, patch: Partial<Finding> = {}): Finding => ({
  id: `source-${strategy}`,
  category: "Frontend",
  title: "Reduce unused JavaScript",
  url: "https://merchant.com/",
  evidence: `Lighthouse ${strategy} at 2026-10-27T00:00:00Z: {"items":[{"wastedBytes":120000}]}`,
  recommendation: "Remove unused code",
  severity: "medium",
  kind: "verified",
  confidence: "high",
  ...patch,
});
describe("Readable, evidence-grounded reports", () => {
  it("compares fresh and database-restored Lighthouse environments by values, preserving real drift detection", () => {
    const fresh = run("desktop");
    const restored = {
      ...fresh,
      environment: {
        form_factor: "desktop",
        throttling_method: null,
        lighthouse_version: "13.5.0",
      },
    };
    expect(JSON.stringify(restored.environment)).not.toBe(
      JSON.stringify(fresh.environment),
    );
    expect(lighthouseIdentity(restored)).toBe(lighthouseIdentity(fresh));
    expect(
      lighthouseIdentity({ ...restored, url: "https://store.example/other" }),
    ).not.toBe(lighthouseIdentity(fresh));
    expect(
      lighthouseIdentity({
        ...restored,
        environment: { ...restored.environment, lighthouse_version: "14.0.0" },
      }),
    ).not.toBe(lighthouseIdentity(fresh));
    expect(
      lighthouseIdentity({
        ...restored,
        environment: { ...restored.environment, throttling_method: "simulate" },
      }),
    ).not.toBe(lighthouseIdentity(fresh));
  });
  it("summarizes long HTML observations and retains resource links without inventing transfer savings", () => {
    const issue = reportIssues(
      [
        finding("html", {
          title: "Images without alt attributes",
          evidence: `7/20 images have no alt attribute. Examples: https://merchant.com/${"x".repeat(600)}.jpg`,
        }),
      ],
      [],
    )[0];
    expect(issue.evidence[0]).toContain("7 of 20");
    expect(issue.evidence[0].length).toBeLessThan(180);
    expect(issue.resources[0].url.length).toBeGreaterThan(600);
    expect(issue.resources[0].wastedBytes).toBeUndefined();
  });
  it("groups mobile/desktop observations while retaining each evidence ID and separate device estimates", () => {
    const issues = reportIssues(
      [finding("mobile"), finding("desktop")],
      [run("mobile"), run("desktop")],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].ids).toEqual(["source-mobile", "source-desktop"]);
    expect(issues[0].evidence).toHaveLength(2);
    expect(issues[0].evidence[0]).toContain("Mobile: 120.0 kB");
    expect(issues[0].evidence[1]).toContain("Desktop: 120.0 kB");
    expect(JSON.stringify(issues[0].evidence)).not.toContain("wastedBytes");
    expect(issues[0].evidence.join(" ")).not.toContain("240.0 kB");
    expect(issues[0].validation).toContain("test cart");
  });
  it("keeps hypotheses separate from verified observations and does not invent savings", () => {
    const issues = reportIssues(
      [finding("mobile"), finding("desktop", { kind: "hypothesis" })],
      [],
    );
    expect(issues).toHaveLength(2);
    expect(issues[1].kind).toBe("hypothesis");
    expect(issues[0].evidence[0]).not.toContain("kB");
    expect(issues[0].resources).toEqual([]);
  });
  it("prioritizes the highest severity within a grouped issue", () => {
    const issues = reportIssues(
      [
        finding("mobile", { severity: "low" }),
        finding("desktop", { severity: "high" }),
        finding("other", { title: "Other issue", severity: "medium" }),
      ],
      [],
    );
    expect(issues[0].severity).toBe("high");
  });
  it("requires three comparable labeled samples and never replaces missing values with zero", () => {
    expect(
      comparableRuns([run("mobile")], "mobile").score("performance"),
    ).toBeNull();
    const samples = [1, 2, 3].map((sample) => run("mobile", sample));
    expect(comparableRuns(samples, "mobile").score("performance")).toBe(60);
    expect(comparableRuns(samples, "mobile").score("accessibility")).toBeNull();
    expect(
      comparableRuns(samples, "mobile").metric("total-blocking-time"),
    ).toBeNull();
    expect(
      comparableRuns(
        [
          samples[0],
          samples[1],
          {
            ...samples[2],
            environment: {
              ...samples[2].environment!,
              lighthouse_version: "different",
            },
          },
        ],
        "mobile",
      ).score("performance"),
    ).toBeNull();
    expect(
      comparableRuns(
        [samples[0], samples[1], { ...samples[2], sample: 2 }],
        "mobile",
      ).score("performance"),
    ).toBeNull();
  });
  it("reports cached timestamps honestly while preserving the returned-response median", () => {
    const stats = comparableRuns(
      [1, 2, 3].map((sample) => run("mobile", sample)),
      "mobile",
    );
    expect(stats.distinctTimes).toBe(1);
    expect(stats.score("performance")).toBe(60);
  });
});
