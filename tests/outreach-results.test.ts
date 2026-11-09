import { describe, expect, it } from "vitest";
import {
  outreachResults,
  rate,
  type ResultsActivity,
  type ResultsLead,
} from "../shared/outreach-results";

const log = (
  lead_id: string,
  kind: string,
  created_at: string,
): ResultsActivity => ({
  lead_id,
  action: "contact_logged",
  details: { kind },
  created_at,
});
const lead = (id: string, patch: Partial<ResultsLead> = {}): ResultsLead => ({
  id,
  industry: "Beauty & skincare",
  country: "AU",
  outcome: null,
  outcome_reason: null,
  outcome_at: null,
  ...patch,
});

describe("Outreach results", () => {
  const activities: ResultsActivity[] = [
    {
      lead_id: "a",
      action: "permission_approved",
      details: null,
      created_at: "2026-11-01T00:00:00Z",
    },
    log("a", "emailed", "2026-11-01T01:00:00Z"),
    log("a", "emailed", "2026-11-07T01:00:00Z"),
    log("a", "replied", "2026-11-08T01:00:00Z"),
    log("a", "call_booked", "2026-11-09T01:00:00Z"),
    log("b", "emailed", "2026-11-02T01:00:00Z"),
    log("b", "replied", "2026-11-03T01:00:00Z"),
    log("b", "replied", "2026-11-04T01:00:00Z"),
    log("c", "emailed", "2026-11-02T01:00:00Z"),
    log("c", "emailed", "2026-11-08T01:00:00Z"),
    log("c", "emailed", "2026-11-15T01:00:00Z"),
    log("d", "no_answer", "2026-11-05T01:00:00Z"),
    log("e", "emailed", "2026-09-01T01:00:00Z"),
  ];
  const leads = [
    lead("a", { outcome: "won", outcome_at: "2026-11-12T00:00:00Z" }),
    lead("b", { industry: "Fashion & apparel, Shoes", country: "GB" }),
    lead("c", {
      outcome: "lost",
      outcome_reason: "No response",
      outcome_at: "2026-11-20T00:00:00Z",
    }),
    lead("d"),
    lead("e"),
  ];

  it("counts leads, not log entries, from the start date", () => {
    const r = outreachResults(activities, leads, "2026-10-01T00:00:00Z");
    expect(r.approved).toBe(1);
    expect(r.emailed).toBe(3); // e was emailed before the range
    expect(r.emails_sent).toBe(6);
    expect(r.replied).toBe(2); // b replied twice: one lead
    expect(r.called).toBe(1);
    expect(r.calls_booked).toBe(1);
    expect([r.won, r.lost]).toEqual([1, 1]);
    expect(r.lost_reasons).toEqual([{ reason: "No response", count: 1 }]);
  });
  it("says which email the reply came after", () => {
    const r = outreachResults(activities, leads, null);
    expect(r.replied_after).toEqual({
      first: 1,
      follow_up: 1,
      final: 0,
      other: 0,
    });
  });
  it("breaks results down by industry and country", () => {
    const r = outreachResults(activities, leads, null);
    expect(r.by_industry[0]).toEqual({
      label: "Beauty & skincare",
      emailed: 3,
      replied: 1,
      won: 1,
    });
    expect(r.by_industry.find((g) => g.label === "Fashion & apparel")).toEqual({
      label: "Fashion & apparel",
      emailed: 1,
      replied: 1,
      won: 0,
    });
    expect(r.by_country.map((g) => g.label)).toEqual(["AU", "GB"]);
  });
  it("shows a dash instead of dividing by nothing", () => {
    expect(rate(1, 4)).toBe("25%");
    expect(rate(0, 0)).toBe("—");
  });
});
