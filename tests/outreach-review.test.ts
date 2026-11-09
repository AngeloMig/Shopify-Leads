import { describe, expect, it } from "vitest";
import {
  countryFromDomain,
  countryNoteFromDomain,
  minCountryNote,
  approvalNeeds,
  nextInQueue,
  reviewChecks,
} from "../shared/outreach-review";

const reason = "Public business contact page, country confirmed.";
const lead = (over = {}) => ({
  country: "GB" as const,
  country_evidence: "UK address on the contact page.",
  contact_url: "https://shop.example/contact",
  emails: [
    {
      email: "hello@shop.example",
      source_url: "https://shop.example/contact",
    },
  ],
  preferred_email: null,
  mail_checks: { "shop.example": "ok" as const },
  shopify_verified: true,
  suppressed: false,
  ...over,
});
const status = (over = {}) =>
  Object.fromEntries(reviewChecks(lead(over)).map((c) => [c.id, c.status]));

describe("reviewChecks", () => {
  it("passes a lead with full evidence", () => {
    expect(new Set(Object.values(status()))).toEqual(new Set(["pass"]));
  });
  it("blocks on the same evidence the server requires", () => {
    expect(status({ country_evidence: null }).country).toBe("blocked");
    expect(status({ country: null }).country).toBe("blocked");
    expect(status({ contact_url: null, emails: [] }).contact).toBe("blocked");
    expect(status({ suppressed: true }).suppression).toBe("blocked");
  });
  it("lets a public email stand in for a missing contact page", () => {
    expect(status({ contact_url: null }).contact).toBe("warn");
    expect(approvalNeeds(lead({ contact_url: null }), reason)).toEqual([]);
    const dead = { mail_checks: { "shop.example": "none" as const } };
    expect(status({ contact_url: null, ...dead }).contact).toBe("blocked");
  });
  it("warns about email problems without blocking approval", () => {
    const none = { emails: [] };
    const dead = { mail_checks: { "shop.example": "none" as const } };
    expect(status(none).email).toBe("warn");
    expect(status(dead).email).toBe("warn");
    expect(approvalNeeds(lead(none), reason)).toEqual([]);
    expect(approvalNeeds(lead(dead), reason)).toEqual([]);
  });
  it("keeps an unchecked mail domain unknown", () => {
    expect(status({ mail_checks: {} }).email).toBe("unknown");
  });
  it("shows the best address, moving dead domains down", () => {
    const check = reviewChecks(
      lead({
        emails: [
          { email: "hello@dead.example", source_url: "https://a.example" },
          { email: "support@shop.example", source_url: "https://b.example" },
        ],
        mail_checks: { "dead.example": "none", "shop.example": "ok" },
      }),
    ).find((c) => c.id === "email")!;
    expect(check.detail).toContain("support@shop.example");
    expect(check.url).toBe("https://b.example");
  });
});
describe("approvalNeeds", () => {
  it("is empty only when the evidence and reason are all there", () => {
    expect(approvalNeeds(lead(), reason)).toEqual([]);
  });
  it("counts the characters still needed, ignoring spaces at the ends", () => {
    expect(approvalNeeds(lead(), "")).toEqual([
      "20 more characters in your reason",
    ]);
    expect(approvalNeeds(lead(), `  ${"x".repeat(19)}  `)).toEqual([
      "1 more character in your reason",
    ]);
    expect(approvalNeeds(lead(), "x".repeat(20))).toEqual([]);
  });
  it("lists every blocker together", () => {
    expect(
      approvalNeeds(
        lead({
          suppressed: true,
          country_evidence: null,
          contact_url: null,
          emails: [],
        }),
        reason,
      ),
    ).toEqual([
      "remove it from the do-not-contact list",
      "country evidence",
      "a public contact page or email",
    ]);
  });
});
describe("nextInQueue", () => {
  const open =
    (...ids: string[]) =>
    (id: string) =>
      ids.includes(id);
  it("moves forward and wraps round", () => {
    expect(nextInQueue(["a", "b", "c"], "a", open("b", "c"))).toBe("b");
    expect(nextInQueue(["a", "b", "c"], "c", open("a", "b"))).toBe("a");
  });
  it("skips leads that are already decided", () => {
    expect(nextInQueue(["a", "b", "c"], "a", open("c"))).toBe("c");
  });
  it("ends when nothing else is open, and never returns the current lead", () => {
    expect(nextInQueue(["a", "b"], "a", open("a"))).toBeNull();
    expect(nextInQueue(["a"], "a", open("a"))).toBeNull();
  });
});

describe("Reasons to review faster", () => {
  it("writes the checks up as a reason that meets the minimum", async () => {
    const { suggestedApproval, approvalNeeds } = await import(
      "../shared/outreach-review"
    );
    const text = suggestedApproval(lead())!;
    expect(text).toMatch(/^Business email .+ is published on the store\./);
    expect(text).toContain("Not on the do-not-contact list.");
    expect(approvalNeeds(lead(), text)).toEqual([]);
  });
  it("suggests nothing while a check still blocks approval", async () => {
    const { suggestedApproval } = await import("../shared/outreach-review");
    expect(
      suggestedApproval(lead({ contact_url: undefined, emails: [] })),
    ).toBeNull();
  });
  it("offers the brand reason first only for a store with its own team", async () => {
    const { rejectionReasons, minRationale } = await import(
      "../shared/outreach-review"
    );
    expect(rejectionReasons(true)[0]).toContain("its own team");
    expect(rejectionReasons(false).some((r) => r.includes("own team"))).toBe(
      false,
    );
    expect(rejectionReasons(true).every((r) => r.length >= minRationale)).toBe(
      true,
    );
  });
  it("guesses the country from the web address, for the reviewer to confirm", () => {
    expect(countryFromDomain("tero.au")).toBe("AU");
    expect(countryFromDomain("shop.com.au")).toBe("AU");
    expect(countryFromDomain("shop.co.uk")).toBe("GB");
    expect(countryFromDomain("shop.ca")).toBe("CA");
    expect(countryFromDomain("shop.com")).toBeNull();
    expect(countryNoteFromDomain("tero.au").length).toBeGreaterThanOrEqual(
      minCountryNote,
    );
    expect(countryNoteFromDomain("shop.com")).toBe("");
  });
  it("lets a confirmed country clear the country check", () => {
    const missing = lead({ country: null, country_evidence: null });
    expect(approvalNeeds(missing, reason)).toContain("country evidence");
    const confirmed = lead({
      country: "AU",
      country_evidence: "Confirmed by the reviewer: Sydney address.",
    });
    expect(approvalNeeds(confirmed, reason)).toEqual([]);
  });
});
