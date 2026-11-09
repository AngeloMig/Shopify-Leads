import { describe, it, expect } from "vitest";
import {
  addDays,
  followUpDays,
  followUpLabel,
  nextEmailStep,
  isDue,
  readContactLog,
} from "../shared/contact-log";

describe("The email sequence", () => {
  it("follows up on day 6, closes the loop a week later, then stops", () => {
    expect(followUpDays("emailed", 0)).toBe(6);
    expect(followUpDays("emailed", 1)).toBe(7);
    expect(followUpDays("emailed", 2)).toBeNull();
    expect(followUpDays("called", 2)).toBe(3);
  });
  it("picks the next email from how many were sent", () => {
    expect(nextEmailStep(0)).toBe("first");
    expect(nextEmailStep(1)).toBe("follow_up");
    expect(nextEmailStep(2)).toBe("final");
    expect(nextEmailStep(3)).toBeNull();
  });
});
describe("The contact log", () => {
  it("keeps each lead's latest contact and counts the touches", () => {
    const log = readContactLog([
      {
        lead_id: "a",
        details: { kind: "replied", follow_up_at: "2026-11-08" },
        created_at: "2026-11-07T10:00:00Z",
      },
      {
        lead_id: "a",
        details: { kind: "emailed", follow_up_at: "2026-11-05" },
        created_at: "2026-11-02T10:00:00Z",
      },
      {
        lead_id: "b",
        details: { kind: "spam" },
        created_at: "2026-11-07T10:00:00Z",
      },
    ]);
    expect(log.get("a")).toEqual({
      kind: "replied",
      at: "2026-11-07T10:00:00Z",
      follow_up_at: "2026-11-08",
      touches: 2,
      emails: 1,
    });
    expect(log.has("b")).toBe(false);
  });
  it("is due on the day or after, and never once won or lost", () => {
    const contact = {
      kind: "emailed" as const,
      at: "",
      follow_up_at: "2026-11-07",
      touches: 1,
    };
    expect(isDue({ contact }, "2026-11-07")).toBe(true);
    expect(isDue({ contact }, "2026-11-06")).toBe(false);
    // Moved to the tracker after a reply: it's followed up there, not here.
    expect(
      isDue({ contact, tracker: { inquiry_id: "x", url: null } }, "2026-11-07"),
    ).toBe(false);
    expect(isDue({ contact, outcome: "won" }, "2026-11-09")).toBe(false);
  });
  it("says when, in words", () => {
    expect(followUpLabel("2026-11-07", "2026-11-07")).toBe("Follow up today");
    expect(followUpLabel("2026-11-08", "2026-11-07")).toBe(
      "Follow up tomorrow",
    );
    expect(followUpLabel("2026-11-05", "2026-11-07")).toBe(
      "Follow-up 2 days overdue",
    );
    expect(addDays("2026-11-29", 3)).toBe("2026-12-02");
  });
});
