import { describe, expect, it } from "vitest";
import {
  automationStatus,
  needsAttention,
  type OperationsSnapshot,
} from "../shared/automation";
import type { Job } from "../shared/types";

const now = Date.parse("2026-11-03T12:00:00Z");
const iso = (ago = 0) => new Date(now - ago).toISOString();
const job = (over: Partial<Job> = {}) =>
  ({
    id: "j1",
    type: "audit",
    status: "completed",
    progress: 100,
    created_at: iso(3600000),
    started_at: iso(3600000),
    completed_at: iso(1000),
    error: null,
    attempts: 1,
    max_attempts: 3,
    payload: { domain: "shop.example" },
    api_usage: {},
    ...over,
  }) as Job;
const ops = (over: Partial<OperationsSnapshot> = {}) =>
  ({
    server_time: iso(),
    workers: [
      { worker_id: "w", last_seen: iso(), state: "idle", job_id: null },
    ],
    usage: { units: 0, discovery_units: 0, audit_units: 0 },
    budgets: {},
    blocks: [],
    queue: [],
    schedules: [],
    ...over,
  }) as OperationsSnapshot;

describe("automationStatus", () => {
  it("waits for data before claiming anything", () => {
    expect(automationStatus([job()], null).tone).toBe("loading");
  });
  it("puts an offline worker above everything else", () => {
    const status = automationStatus(
      [job({ status: "running" }), job({ id: "j2", status: "queued" })],
      ops({ workers: [] }),
    );
    expect(status).toMatchObject({ tone: "problem", action: "worker" });
    expect(status.detail).toContain("2 jobs");
  });
  it("says what's running and mentions what else is pending", () => {
    const status = automationStatus(
      [
        job({ status: "running" }),
        job({ id: "j2", status: "queued" }),
        job({ id: "j3", status: "blocked" }),
      ],
      ops(),
    );
    expect(status).toMatchObject({ tone: "running", action: "watch" });
    expect(status.detail).toBe("1 more waiting · 1 needs attention");
  });
  it("sends you to problems when nothing is running", () => {
    expect(automationStatus([job({ status: "blocked" })], ops())).toMatchObject(
      {
        tone: "problem",
        title: "1 job needs attention",
        action: "attention",
      },
    );
  });
  it("explains why queued work is waiting", () => {
    const status = automationStatus(
      [job({ status: "queued", available_at: iso(1000) })],
      ops(),
    );
    expect(status.tone).toBe("waiting");
    expect(status.title).toBe("1 job waiting: queued");
  });
  it("has a first-visit state", () => {
    expect(automationStatus([], ops()).tone).toBe("first");
  });
  it("names the next scheduled run, ignoring disabled ones", () => {
    const schedule = (enabled: boolean, next_run_at: string) => ({
      id: next_run_at,
      name: "Run",
      enabled,
      next_run_at,
      interval_hours: 24,
    });
    expect(
      automationStatus(
        [job()],
        ops({
          schedules: [
            schedule(false, "2026-11-03T13:00:00Z"),
            schedule(true, "2026-11-04T00:00:00Z"),
          ],
        }),
      ).detail,
    ).toContain("Nov 4");
    expect(automationStatus([job()], ops()).detail).toContain("No runs");
  });
});
describe("needsAttention", () => {
  it("keeps blocked jobs and lets old failures go", () => {
    expect(needsAttention(job({ status: "blocked" }), now)).toBe(true);
    expect(needsAttention(job({ status: "failed" }), now)).toBe(true);
    expect(
      needsAttention(
        job({ status: "failed", completed_at: iso(2 * 86400000) }),
        now,
      ),
    ).toBe(false);
    expect(needsAttention(job(), now)).toBe(false);
  });
});
