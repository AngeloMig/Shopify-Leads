import { describe, it, expect } from "vitest";
import {
  leadIntelligence,
  rankedEmails,
  contactCategory,
  classifyIndustry,
  shortBusinessName,
  hasFrontendOpportunity,
} from "../shared/lead-intelligence";
import { importDomains } from "../shared/domain-import";
import { demoSnapshot } from "../src/demo";
const base = demoSnapshot.leads[0];
describe("Lead decisions and contacts", () => {
  it("screens supported frontend findings directly without a numeric redesign score", () => {
    const finding = {
      id: "f",
      category: "Images",
      url: "https://store.example",
      title: "Observed issue",
      evidence: "Recorded",
      recommendation: "Review",
      severity: "medium" as const,
      kind: "verified" as const,
      confidence: "high" as const,
    };
    expect(hasFrontendOpportunity({ findings: [finding] })).toBe(true);
    expect(
      hasFrontendOpportunity({
        findings: [{ ...finding, kind: "hypothesis" }],
      }),
    ).toBe(false);
    expect(hasFrontendOpportunity({ findings: [] })).toBe(false);
  });
  it("separates technical opportunity from pending permission", () => {
    const lead = {
      ...base,
      permission: "unknown" as const,
      priority: 0,
      performance: 35,
      suppressed: false,
      findings: [
        {
          id: "f",
          category: "Frontend",
          url: "https://store.example",
          title: "Reduce unused JavaScript",
          evidence: "Observed",
          recommendation: "Review unused code",
          severity: "medium" as const,
          kind: "verified" as const,
          confidence: "high" as const,
        },
      ],
    };
    const i = leadIntelligence(lead);
    expect(i.label).toBe("Strong");
    expect(i.review).toBe("Review pending");
    expect(i.main).toBe("Slow mobile loading");
  });
  it("does not infer opportunity from a low score alone or a hypothesis", () => {
    expect(
      leadIntelligence({
        ...base,
        performance: 5,
        findings: [],
        suppressed: false,
      }).rank,
    ).toBe(0);
  });
  it("ranks general addresses before HR and preserves the explicit preference", () => {
    const emails = ["hr@store.com", "support@store.com", "hello@store.com"].map(
      (email) => ({ email, source_url: "https://store.com/contact" }),
    );
    expect(rankedEmails(emails)[0].email).toBe("hello@store.com");
    expect(rankedEmails(emails, "hr@store.com")[0].email).toBe("hr@store.com");
    expect(contactCategory("hr@store.com")).toBe("Careers");
    expect(contactCategory("customercare@parent-brand.com")).toBe("Support");
    expect(emails[0].email).toBe("hr@store.com");
  });
  it("classifies product evidence and leaves conflicting or sparse evidence unknown", () => {
    expect(
      classifyIndustry([
        {
          title: "Canadian boutique clothing & fashion dresses",
          url: "https://store.com",
        },
      ]).industry,
    ).toBe("Fashion & apparel");
    expect(classifyIndustry([{ title: "Welcome to our shop" }]).industry).toBe(
      "Unknown",
    );
    expect(
      classifyIndustry([{ title: "clothing fashion skincare serum" }]).industry,
    ).toBe("Unknown");
  });
  it("does not classify solely from country or query labels", () => {
    expect(
      classifyIndustry([
        { title: "About us", description: "Located in Canada" },
      ]).industry,
    ).toBe("Unknown");
  });
  it("prefers a short brand segment and keeps a usable fallback", () => {
    expect(
      shortBusinessName(
        "Womens Boutique Fashion Wholesale Online | ENI&KO Australia",
        "eniandko.com.au",
      ),
    ).toBe("ENI&KO Australia");
    expect(
      shortBusinessName(
        "Vestique | Womens Online Boutique | Fashion Dress Clothing Store",
        "vestique.com",
      ),
    ).toBe("Vestique");
  });
  it("retains suppression independently of measurements", () => {
    const i = leadIntelligence({ ...base, suppressed: true, performance: 10 });
    expect(i.review).toBe("Suppressed");
    expect(i.next).toBe("Do not contact");
  });
});
describe("Domain import parsing", () => {
  it("reads CSV website columns including quoted commas in other fields", () =>
    expect(
      importDomains(
        'Name,Website\n"Store, Inc",https://store.com\nOther,other.com',
      ),
    ).toEqual(["https://store.com", "other.com"]));
  it("accepts domain lists and rejects ambiguous or oversized input", () => {
    expect(importDomains("store.com\r\nother.com")).toEqual([
      "store.com",
      "other.com",
    ]);
    expect(() => importDomains("Store,store.com")).toThrow("column header");
    expect(() => importDomains(Array(51).fill("store.com").join("\n"))).toThrow(
      "50",
    );
    expect(() => importDomains('"store.com')).toThrow("unfinished");
  });
});
