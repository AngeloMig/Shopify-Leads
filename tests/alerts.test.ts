import { describe, expect, it } from "vitest";
import {
  buildAlerts,
  digestText,
  type AlertInput,
  type Digest,
} from "../shared/alerts";

const at = Date.parse("2026-11-03T12:00:00Z");
const digest: Digest = {
  since: new Date(at - 86400000).toISOString(),
  new_leads: 0,
  audits_completed: 0,
  failed_jobs: 0,
  awaiting_review: 0,
  top_leads: [],
};
const input = (over: Partial<AlertInput> = {}): AlertInput => ({
  at,
  workers: [{ state: "idle", last_seen: new Date(at - 10000).toISOString() }],
  blocks: [],
  usage: {},
  budgets: { daily_api_budget: 100 },
  failures: [],
  digest,
  ...over,
});
const keys = (over: Partial<AlertInput> = {}) =>
  buildAlerts(input(over)).map((a) => a.key);

describe("buildAlerts", () => {
  it("stays quiet when nothing needs attention", () => {
    expect(keys()).toEqual([]);
  });
  it("reports a worker that stopped or went silent", () => {
    expect(keys({ workers: [] })).toEqual(["worker_offline"]);
    expect(
      keys({
        workers: [
          { state: "idle", last_seen: new Date(at - 120000).toISOString() },
        ],
      }),
    ).toEqual(["worker_offline"]);
    expect(
      keys({
        workers: [{ state: "stopped", last_seen: new Date(at).toISOString() }],
      }),
    ).toEqual(["worker_offline"]);
  });
  it("counts a paused worker as online", () => {
    expect(
      keys({
        workers: [{ state: "paused", last_seen: new Date(at).toISOString() }],
      }),
    ).toEqual([]);
  });
  it("ignores a provider pause that has already ended", () => {
    const block = (blocked_until: string | null) => ({
      provider: "PageSpeed",
      reason: "Rate limited",
      blocked_until,
    });
    expect(
      keys({ blocks: [block(new Date(at + 1000).toISOString())] }),
    ).toEqual(["provider_paused:PageSpeed"]);
    expect(keys({ blocks: [block(null)] })).toEqual([
      "provider_paused:PageSpeed",
    ]);
    expect(
      keys({ blocks: [block(new Date(at - 1000).toISOString())] }),
    ).toEqual([]);
  });
  it("reports the total budget in place of its categories", () => {
    expect(
      keys({
        usage: { units: 100, audit_units: 50 },
        budgets: { daily_api_budget: 100, audit_daily_budget: 50 },
      }),
    ).toEqual(["budget_total"]);
    expect(
      keys({
        usage: { units: 50, audit_units: 50 },
        budgets: { daily_api_budget: 100, audit_daily_budget: 50 },
      }),
    ).toEqual(["budget_audit"]);
  });
  it("doesn't report a category someone set to 0 on purpose", () => {
    expect(
      keys({
        usage: { units: 5 },
        budgets: { daily_api_budget: 100, discovery_daily_budget: 0 },
      }),
    ).toEqual([]);
  });
  it("lists problems before good news and names the top lead", () => {
    const alerts = buildAlerts(
      input({
        failures: [{ error: "Timed out" }],
        digest: {
          ...digest,
          new_leads: 2,
          awaiting_review: 1,
          top_leads: [{ id: "1", name: "Oak & Ash", score: 71 }],
        },
      }),
    );
    expect(alerts.map((a) => a.key)).toEqual([
      "jobs_failed",
      "new_leads",
      "review_waiting",
    ]);
    expect(alerts[0].detail).toBe("Timed out");
    expect(alerts[1].detail).toBe("Top: Oak & Ash (71/100).");
  });
});
describe("failed job links", () => {
  const path = (failures: AlertInput["failures"]) =>
    buildAlerts(input({ failures }))[0].path;
  it("opens the job when there's one, or the filtered list when there are more", () => {
    expect(path([{ id: "abc", error: "x" }])).toBe("/jobs/abc");
    expect(
      path([
        { id: "a", error: "x" },
        { id: "b", error: "y" },
      ]),
    ).toBe("/jobs?filter=attention");
  });
});
describe("digestText", () => {
  it("adds only the sections that have something in them", () => {
    expect(digestText(digest, [], "Acme")).toBe(
      "Scout daily digest · Acme\n0 new leads · 0 audits completed · 0 failed jobs · 0 awaiting review",
    );
    const text = digestText(
      {
        ...digest,
        new_leads: 1,
        top_leads: [{ id: "1", name: "Oak", score: null }],
      },
      buildAlerts(input({ workers: [] })),
      "Acme",
    );
    expect(text).toContain("1 new lead ·");
    expect(text).toContain("• Oak\n");
    expect(text).toContain("Needs attention:\n• Worker is offline");
  });
});
