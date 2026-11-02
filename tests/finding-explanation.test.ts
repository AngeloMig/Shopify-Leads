import { describe, expect, it } from "vitest";
import type { Finding, PsiSample } from "../shared/types";
import { reportIssues } from "../shared/audit-presentation";
import { explainFinding } from "../shared/finding-explanation";

const details = {
  items: [
    {
      node: {
        nodeLabel: "Free Shipping On Orders $199+",
        explanation:
          "Element has insufficient color contrast of 3.01 (foreground color: #ffffff, background color: #cc7f8a). Expected contrast ratio of 4.5:1",
      },
    },
  ],
};
const finding = (patch: Partial<Finding> = {}): Finding => ({
  id: "original-desktop",
  category: "Accessibility",
  title:
    "Background and foreground colors do not have a sufficient contrast ratio.",
  url: "https://store.example/",
  evidence: `Lighthouse desktop at 2026-10-27T00:00:00Z: ${JSON.stringify(details)}`,
  severity: "medium",
  kind: "verified",
  confidence: "high",
  recommendation: "Original recommendation",
  ...patch,
});
const explain = (findings: Finding[], samples: PsiSample[] = []) => {
  const issues = reportIssues(findings, samples);
  return { issues, explanation: explainFinding(issues[0], findings, samples) };
};
describe("Client-readable audit findings", () => {
  it("keeps CSS selectors out of the client-facing examples", () => {
    const source = finding({
      title: "Links do not have a discernible name",
      evidence: `Lighthouse desktop at time: ${JSON.stringify({ items: [{ node: { nodeLabel: "div.header > div#logo > a" } }] })}`,
    });
    expect(explain([source]).explanation.examples[0].text).toBe(
      "A link without a readable label",
    );
  });
  it("explains contrast in plain English and keeps the recorded ratio tied to the example", () => {
    const { explanation } = explain([finding()]);
    expect(explanation.title).toBe("Some text is difficult to read");
    expect(explanation.action).toContain("text or background colour");
    expect(explanation.examples[0]).toEqual({
      text: "Free Shipping On Orders $199+",
      measurement: "Recorded contrast 3.01:1; required for this text 4.5:1.",
      page: "https://store.example/",
      device: "Desktop",
    });
    expect(explanation.meaning).not.toContain("debugData");
  });
  it("groups device observations and retains every source ID without repeating the same example", () => {
    const { issues, explanation } = explain([
      finding(),
      finding({
        id: "original-mobile",
        evidence: finding().evidence.replace("desktop", "mobile"),
      }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].ids).toEqual(["original-desktop", "original-mobile"]);
    expect(explanation.examples).toHaveLength(1);
  });
  it("uses full saved diagnostics when the original evidence was truncated", () => {
    const source = finding({
      evidence: 'Lighthouse desktop at 2026-10-27T00:00:00Z: {"items":[',
    });
    const sample: PsiSample = {
      url: source.url,
      strategy: "desktop",
      sample: 1,
      tested_at: "2026-10-27T00:00:00Z",
      scores: {},
      diagnostics: { "color-contrast": { title: source.title, details } },
      field_data: { available: false, scope: "unavailable", metrics: {} },
    };
    expect(
      explain([source], [sample]).explanation.examples[0].measurement,
    ).toContain("3.01:1");
    expect(explain([source]).explanation.examples).toEqual([]);
  });
  it("never invents a contrast measurement when only an element label was recorded", () => {
    const source = finding({
      evidence: `Lighthouse desktop at time: ${JSON.stringify({ items: [{ node: { nodeLabel: "Chat with us" } }] })}`,
    });
    expect(
      explain([source]).explanation.examples[0].measurement,
    ).toBeUndefined();
  });
  it("limits visible examples and normalizes repeated whitespace", () => {
    const source = finding({
      evidence: `Lighthouse desktop at time: ${JSON.stringify({ items: Array.from({ length: 10 }, (_, i) => ({ node: { nodeLabel: `Link  ${i}\nlabel` } })) })}`,
    });
    const { explanation } = explain([source]);
    expect(explanation.examples).toHaveLength(3);
    expect(explanation.examples[0].text).toBe("Link 0 label");
  });
  it("keeps unknown findings and their actual recommendations without inventing a diagnosis", () => {
    const { explanation } = explain([
      finding({
        title: "Custom observation",
        evidence: "Observed a custom condition",
        recommendation: "Verify the recorded condition",
      }),
    ]);
    expect(explanation.title).toBe("Custom observation");
    expect(explanation.action).toBe("Verify the recorded condition");
    expect(explanation.examples).toEqual([]);
  });
  it("keeps hypotheses separate and never upgrades a low-confidence grouped finding", () => {
    const { issues } = explain([
      finding(),
      finding({ id: "second", confidence: "low" }),
      finding({ id: "hypothesis", kind: "hypothesis" }),
    ]);
    expect(issues).toHaveLength(2);
    expect(issues[0].confidence).toBe("low");
    expect(issues[1].kind).toBe("hypothesis");
  });
});
