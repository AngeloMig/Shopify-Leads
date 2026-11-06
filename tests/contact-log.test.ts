import { describe, it, expect } from "vitest";
import {
  addDays,
  followUpLabel,
  isDue,
  readContactLog,
} from "../shared/contact-log";

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
