import { describe, it, expect } from "vitest";
import { dueForReaudit, type ReauditCandidate } from "../server/lib/reaudits";

const now = Date.parse("2026-11-09T00:00:00Z");
const lead = (patch: Partial<ReauditCandidate> = {}): ReauditCandidate => ({
  store_id: "s",
  research_score: 72,
  audited_at: "2026-10-01T00:00:00Z",
  contacted: false,
  closed: false,
  suppressed: false,
  active_job: false,
  ...patch,
});

describe("Monthly re-audits", () => {
  it("re-tests good, uncontacted leads audited 30 or more days ago", () => {
    expect(dueForReaudit([lead()], now)).toHaveLength(1);
    expect(
      dueForReaudit([lead({ audited_at: "2026-10-20T00:00:00Z" })], now),
    ).toHaveLength(0);
  });
  it("skips weak, contacted, closed, opted-out or already queued leads", () => {
    for (const patch of [
      { research_score: 40 },
      { contacted: true },
      { closed: true },
      { suppressed: true },
      { active_job: true },
      { audited_at: null },
    ])
      expect(dueForReaudit([lead(patch)], now)).toEqual([]);
  });
  it("takes the strongest first, up to the room left today", () => {
    const due = dueForReaudit(
      [
        lead({ store_id: "b", research_score: 55 }),
        lead({ store_id: "a", research_score: 90 }),
        lead({ store_id: "c", research_score: 70 }),
      ],
      now,
      2,
    );
    expect(due.map((d) => d.store_id)).toEqual(["a", "c"]);
    expect(dueForReaudit([lead()], now, 0)).toEqual([]);
  });
});
