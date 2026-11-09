import { describe, it, expect } from "vitest";
import { leadNextStep } from "../shared/lead-next-step";

const today = "2026-11-09";
const base = {
  suppressed: false,
  outcome: null,
  outcome_reason: null,
  permission: "approved" as const,
  contact: null,
  emails: [{ email: "hi@store.example" }] as never,
  contact_url: undefined,
};
const o = { stale: false, completedAudits: 1, today };
const emailed = (emails: number, follow_up_at: string | null) => ({
  kind: "emailed" as const,
  at: "2026-11-01T00:00:00Z",
  follow_up_at,
  touches: emails,
  emails,
});

describe("The next step on a lead", () => {
  it("asks for a review before any outreach", () => {
    expect(leadNextStep({ ...base, permission: "unknown" }, o).action).toBe(
      "review",
    );
  });
  it("asks for a re-test first when the audit is old", () => {
    expect(leadNextStep(base, { ...o, stale: true }).action).toBe("retest");
  });
  it("walks the three emails, waiting between them", () => {
    expect(leadNextStep(base, o).title).toBe("Send the first email");
    const waiting = leadNextStep(
      { ...base, contact: emailed(1, "2026-11-12") },
      o,
    );
    expect(waiting.action).toBeNull();
    expect(waiting.detail).toContain("follow-up");
    expect(
      leadNextStep({ ...base, contact: emailed(1, "2026-11-08") }, o).title,
    ).toBe("Send the follow-up");
    expect(
      leadNextStep({ ...base, contact: emailed(2, "2026-11-09") }, o).title,
    ).toBe("Send the final email");
    expect(leadNextStep({ ...base, contact: emailed(3, null) }, o).action).toBe(
      "lost_no_response",
    );
  });
  it("moves to a call once they reply", () => {
    const replied = { ...emailed(1, null), kind: "replied" as const };
    expect(leadNextStep({ ...base, contact: replied }, o).action).toBe(
      "call_booked",
    );
  });
  it("offers the before and after for won clients", () => {
    const won = { ...base, outcome: "won" as const };
    expect(leadNextStep(won, o).action).toBe("reaudit");
    expect(leadNextStep(won, { ...o, completedAudits: 2 }).action).toBe(
      "before_after",
    );
  });
  it("never suggests contact for suppressed stores", () => {
    expect(leadNextStep({ ...base, suppressed: true }, o).action).toBeNull();
  });
});
