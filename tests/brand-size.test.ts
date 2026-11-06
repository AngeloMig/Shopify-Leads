import { describe, it, expect } from "vitest";
import { brandSize } from "../shared/brand-size";
import { leadScore, type LeadScoreInput } from "../shared/lead-score";

const emails = (...locals: string[]) =>
  locals.map((l) => ({ email: `${l}@shop.example` }));

describe("Telling a big brand from an independent store", () => {
  it("leaves a small store with one general inbox independent", () => {
    expect(
      brandSize({
        domain: "synergieskin.com",
        title: "Synergie Skin - Australian Cosmeceutical Skincare",
        emails: emails("info"),
      }),
    ).toEqual({ verdict: "independent", signals: [] });
  });
  it("flags separate country stores and an official store name", () => {
    const b = brandSize({
      domain: "us.medik8.com",
      title: "Official Medik8 US – Medik8-US",
    });
    expect(b.verdict).toBe("likely_agency");
    expect(b.signals.map((s) => s.label)).toEqual([
      "Runs separate country stores (us.medik8.com)",
      "Calls itself the official store",
    ]);
  });
  it("reads department inboxes and lists of staff mailboxes", () => {
    expect(
      brandSize({
        domain: "eastfork.com",
        emails: emails("care", "press", "hospitality", "community"),
      }).signals,
    ).toEqual([{ label: "Has press, trade accounts inboxes", weight: 2 }]);
    expect(
      brandSize({
        domain: "oliverspencer.co.uk",
        emails: emails("info", "martin", "ivan", "jon", "camillac"),
      }),
    ).toMatchObject({
      verdict: "likely_agency",
      signals: [{ label: "4 staff mailboxes listed" }],
    });
  });
  it("doesn't take an owner's own mailbox, or the store's name, for staff", () => {
    expect(
      brandSize({
        domain: "puremessskincare.com",
        emails: emails("gemma", "puremess", "hello"),
      }).verdict,
    ).toBe("independent");
  });
  it("counts one weak sign as possibly established, not an agency", () => {
    expect(
      brandSize({ domain: "moderndane.com", title: "The Modern Dane®" })
        .verdict,
    ).toBe("possibly_established");
  });
  it("reads home page links and country versions from new audits", () => {
    expect(
      brandSize({
        domain: "shop.example",
        evidence: {
          links: [
            "https://shop.example/pages/careers",
            "https://shop.example/pages/stockists",
          ],
          locales: 4,
        },
      }).signals.map((s) => s.label),
    ).toEqual([
      "Has a careers page, a stockists or wholesale page",
      "Sells in 4 languages or countries",
    ]);
  });
});

describe("Scoring a brand with its own team", () => {
  const strong: LeadScoreInput = {
    findings: [
      { kind: "verified", severity: "high", category: "Performance" },
      { kind: "verified", severity: "medium", category: "Images" },
    ],
    performance: 25,
    activity: 80,
    emails: [{ email: "info@shop.example" }],
    countryVerified: true,
    shopifyVerified: true,
    permissionApproved: true,
    suppressed: false,
  };
  it("gives an independent store the full 20 and holds a big brand at 49", () => {
    const own = leadScore({ ...strong, domain: "oakash.example" });
    const brand = leadScore({
      ...strong,
      domain: "us.bigbrand.example",
      title: "Official Big Brand US Store",
    });
    expect(own.parts.find((p) => p.key === "independent")!.points).toBe(20);
    expect(own.researchScore).toBeGreaterThan(49);
    expect(brand.researchScore).toBe(49);
    expect(brand.brand?.verdict).toBe("likely_agency");
    expect(brand.parts.find((p) => p.key === "independent")!.reason).toContain(
      "Likely has its own team or agency",
    );
  });
});
