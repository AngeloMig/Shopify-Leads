import { describe, it, expect } from "vitest";
import { listingPriority, prospectScore } from "../shared/local-prospect";
import { readGeoapifyPlace } from "../shared/local-business";

const lead = (over: Partial<Parameters<typeof prospectScore>[0]> = {}) => ({
  trade: "Roofing contractor",
  website_check: "no_site_found" as const,
  social_links: [],
  phone: null,
  email: null,
  opening_hours: null,
  ...over,
});

describe("How likely a local business is to buy a website", () => {
  it("rates a roofer with no site, a phone and a Facebook page as strong", () => {
    const p = prospectScore(
      lead({
        phone: "+1 555 0100",
        social_links: [
          { network: "facebook", url: "https://facebook.com/ridgeway" },
        ],
      }),
    );
    expect(p).toMatchObject({ score: 90, tier: "strong" });
    expect(p.reasons.map((r) => r.points)).toEqual([30, 25, 20, 15]);
  });
  it("counts a high-value trade above a walk-in one", () => {
    const roofer = prospectScore(lead()).score;
    const takeaway = prospectScore(lead({ trade: "Takeaway and fast food" }));
    expect(roofer).toBe(55);
    expect(takeaway).toMatchObject({ score: 35, tier: "weak" });
  });
  it("keeps a business that already has a site low, whatever else it has", () => {
    const p = prospectScore(
      lead({
        website_check: "site_found",
        phone: "1",
        email: "a@b.c",
        opening_hours: "Mo-Fr",
      }),
    );
    expect(p).toMatchObject({ score: 15, tier: "weak" });
    expect(p.reasons.at(-1)!.text).toBe("Already has a website");
  });
  it("never goes past 100", () => {
    const p = prospectScore(
      lead({
        phone: "1",
        email: "a@b.c",
        opening_hours: "Mo-Fr",
        social_links: [
          { network: "instagram", url: "https://instagram.com/x" },
        ],
      }),
    );
    expect(p.score).toBe(100);
  });
});

describe("Which listings a search takes first", () => {
  const place = (props: Record<string, unknown>) =>
    readGeoapifyPlace({ properties: { place_id: "p", name: "N", ...props } })!;
  it("puts reachable listings first and listings with a website last", () => {
    const bare = place({});
    const phone = place({ contact: { phone: "555" } });
    const site = place({
      website: "https://n.example",
      contact: { phone: "5" },
    });
    const order = [site, bare, phone].sort(
      (a, b) => listingPriority(b) - listingPriority(a),
    );
    expect(order).toEqual([phone, bare, site]);
  });
});
