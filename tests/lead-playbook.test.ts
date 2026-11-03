import { describe, expect, it } from "vitest";
import {
  hasFullEvidence,
  leadPlaybook,
  planText,
  callText,
} from "../shared/lead-playbook";
import type { Finding } from "../shared/types";

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "f1",
  category: "Performance",
  url: "https://shop.example/",
  title: "Reduce unused JavaScript",
  evidence: "Lighthouse flagged unused JavaScript.",
  severity: "high",
  confidence: "high",
  recommendation: "Review scripts.",
  kind: "verified",
  ...over,
});
const lead = (over = {}) => ({
  name: "Oak & Ash",
  domain: "oakash.example",
  findings: [finding()],
  performance: 34,
  audited_at: "2026-11-02T10:00:00Z",
  emails: [
    { email: "hello@oakash.example", source_url: "https://oakash.example/c" },
  ],
  preferred_email: null,
  mail_checks: {},
  contact_url: "https://oakash.example/contact",
  ...over,
});

describe("hasFullEvidence", () => {
  it("rejects list-view findings that have no text yet", () => {
    expect(hasFullEvidence(lead())).toBe(true);
    expect(hasFullEvidence(lead({ findings: [] }))).toBe(true);
    expect(
      hasFullEvidence(
        lead({
          findings: [finding({ url: "", evidence: "", recommendation: "" })],
        }),
      ),
    ).toBe(false);
  });
  it("doesn't wait forever on one blank finding among real ones", () => {
    expect(
      hasFullEvidence(
        lead({
          findings: [finding(), finding({ id: "f2", url: "", evidence: "" })],
        }),
      ),
    ).toBe(true);
  });
});
describe("leadPlaybook", () => {
  it("builds a plan and script from verified findings", () => {
    const plan = leadPlaybook(lead());
    expect(plan.needs).toHaveLength(1);
    expect(plan.needs[0].service).toContain("JavaScript");
    expect(plan.needs[0].steps.length).toBeGreaterThan(0);
    expect(plan.email?.subject).toContain("oakash.example");
    expect(plan.email?.body).toContain("Hi Oak & Ash team");
    expect(plan.email?.body).toContain("34/100");
    expect(plan.call?.map((c) => c.label)).toContain("If they say no");
    expect(plan.contact).toBe("hello@oakash.example");
  });
  it("keeps unverified ideas out of the script", () => {
    const plan = leadPlaybook(
      lead({
        findings: [
          finding(),
          finding({
            id: "f2",
            title: "Checkout might lose customers",
            kind: "hypothesis",
          }),
        ],
      }),
    );
    expect(plan.toConfirm.length).toBe(1);
    const all = `${plan.email?.body} ${callText(plan)} ${planText(lead(), plan)}`;
    expect(all).not.toMatch(/might lose customers/i);
  });
  it("writes no script without a verified finding", () => {
    const plan = leadPlaybook(
      lead({ findings: [finding({ kind: "hypothesis" })] }),
    );
    expect(plan.needs).toEqual([]);
    expect(plan.email).toBeNull();
    expect(plan.call).toBeNull();
  });
  it("makes no claims about sales, revenue or guarantees", () => {
    const plan = leadPlaybook(lead());
    expect(`${plan.email?.body} ${callText(plan)}`).not.toMatch(
      /revenue|sales|conversion|guarantee|increase|\$/i,
    );
  });
  it("leaves out a score that was never measured", () => {
    const plan = leadPlaybook(lead({ performance: null }));
    expect(plan.email?.body).not.toContain("/100");
    expect(plan.email?.body).not.toContain("null");
  });
  it("always offers a way to opt out", () => {
    const plan = leadPlaybook(lead());
    expect(plan.email?.body).toContain("I won't contact you again");
    expect(plan.call?.at(-1)?.text).toContain("don't contact you again");
  });
  it("skips dead mail domains and falls back to the contact page", () => {
    const plan = leadPlaybook(
      lead({ mail_checks: { "oakash.example": "none" } }),
    );
    expect(plan.contact).toBe("https://oakash.example/contact");
  });
  it("orders the most serious need first and merges shared services", () => {
    const plan = leadPlaybook(
      lead({
        findings: [
          finding({
            id: "a",
            category: "Accessibility",
            title: "Links do not have a discernible name",
            severity: "low",
          }),
          finding({ id: "b" }),
          finding({ id: "c", title: "Reduce unused JavaScript again" }),
        ],
      }),
    );
    expect(plan.needs[0].severity).toBe("high");
    expect(plan.needs.at(-1)?.severity).toBe("low");
  });
});
