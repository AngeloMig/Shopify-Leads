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

describe("leadPlaybook with your details", () => {
  const me = {
    name: "Grant Rivera",
    company: "Rivera Studio",
    address: "1 Example St, Brisbane QLD",
    portfolio_url: "https://www.riverastudio.example/",
    work: [] as { title: string; url: string; industry: string }[],
  };
  it("fills your name, company, address and portfolio into the email", () => {
    const body = leadPlaybook(lead(), me).email!.body;
    expect(body).toContain("I'm Grant Rivera from Rivera Studio.");
    expect(body).toContain(
      "You can see some of our recent work at https://www.riverastudio.example/",
    );
    expect(body).toMatch(
      /Grant Rivera\nRivera Studio\n1 Example St, Brisbane QLD\nhttps:\/\/www\.riverastudio\.example\/$/,
    );
    expect(body).not.toContain("[Your");
  });
  it("names the portfolio the way you'd say it on a call", () => {
    const call = leadPlaybook(lead(), me).call!;
    expect(call[0].text).toContain("this is Grant Rivera from Rivera Studio");
    expect(call.find((c) => c.label === "Next step")!.text).toContain(
      "You can also see sites we've built at riverastudio.example.",
    );
  });
  it("keeps placeholders, and no portfolio line, for details not set", () => {
    const body = leadPlaybook(lead()).email!.body;
    expect(body).toContain("[Your name]");
    expect(body).not.toContain("recent work");
  });
});

describe("leadPlaybook with matching work", () => {
  it("points to a project in the store's industry instead of the portfolio", () => {
    const sender = {
      name: "Grant",
      company: "Studio",
      address: "",
      portfolio_url: "https://studio.example",
      work: [
        {
          title: "Harbor Pets",
          url: "https://harborpets.example",
          industry: "Pet products",
        },
        {
          title: "Oak & Ash",
          url: "https://oakash.example",
          industry: "Home & furniture",
        },
      ],
    };
    const plan = leadPlaybook(
      { ...lead(), industry: "Home & furniture" },
      sender,
    );
    expect(plan.email!.body).toContain(
      "We recently worked on Oak & Ash, another home & furniture store: https://oakash.example",
    );
    expect(plan.email!.body).not.toContain("recent work at");
    expect(plan.call!.find((c) => c.label === "Next step")!.text).toContain(
      "We did similar work for Oak & Ash, another home & furniture store.",
    );
    const other = leadPlaybook({ ...lead(), industry: "Electronics" }, sender);
    expect(other.email!.body).toContain(
      "You can see some of our recent work at https://studio.example",
    );
  });
});
