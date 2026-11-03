import { describe, expect, it } from "vitest";
import {
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
    expect(status({ contact_url: null }).contact).toBe("blocked");
    expect(status({ suppressed: true }).suppression).toBe("blocked");
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
        lead({ suppressed: true, country_evidence: null, contact_url: null }),
        reason,
      ),
    ).toEqual([
      "remove it from the do-not-contact list",
      "country evidence",
      "a public contact page",
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
