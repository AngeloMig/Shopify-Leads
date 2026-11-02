import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  JobError,
  failureDecision,
  retryAfter,
} from "../server/lib/job-errors";
import {
  jobPresentation,
  philippineTime,
  type OperationsSnapshot,
} from "../shared/automation";
import type { Job } from "../shared/types";
import { providerJson } from "../server/lib/network";
const now = Date.parse("2026-10-27T19:00:00Z");
describe("Retry decisions and Philippine-time job states", () => {
  it("keeps HTTP rate-limit metadata without exposing a key or retrying invisibly", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("", { status: 429, headers: { "retry-after": "120" } }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        providerJson(
          "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?key=private-fixture-key",
        ),
      ).rejects.toMatchObject({
        code: "rate_limit",
        provider: "pagespeed",
        retryAfterMs: 120000,
        message: "Provider request failed (429)",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("defers budget exhaustion without consuming an attempt", () => {
    expect(
      failureDecision(
        new Error("Daily API request budget exhausted"),
        3,
        3,
        now,
      ),
    ).toMatchObject({
      status: "queued",
      restoreAttempt: true,
      availableAt: "2026-10-28T00:00:00.000Z",
    });
  });
  it("blocks credentials and robots restrictions instead of retrying them", () => {
    expect(
      failureDecision(
        new JobError("Forbidden", "credentials", "tavily"),
        1,
        3,
        now,
      ).status,
    ).toBe("blocked");
    expect(
      failureDecision(
        new Error("Crawling disallowed by robots.txt: /"),
        1,
        3,
        now,
      ).status,
    ).toBe("blocked");
    expect(
      failureDecision(
        new Error("Domain is suppressed; audit cancelled."),
        1,
        3,
        now,
      ).status,
    ).toBe("blocked");
  });
  it("honours Retry-After and uses bounded exponential retry jitter", () => {
    expect(retryAfter("120", now)).toBe(120000);
    expect(retryAfter(new Date(now + 60000).toUTCString(), now)).toBe(60000);
    expect(retryAfter("invalid", now)).toBeUndefined();
    expect(
      failureDecision(
        new JobError("Rate limited", "rate_limit", "pagespeed", 120000),
        1,
        3,
        now,
      ).availableAt,
    ).toBe(new Date(now + 120000).toISOString());
    expect(
      Date.parse(
        failureDecision(new Error("fetch failed"), 2, 3, now, () => 0)
          .availableAt,
      ) - now,
    ).toBe(45000);
    expect(failureDecision(new Error("fetch failed"), 3, 3, now).status).toBe(
      "failed",
    );
  });
  it("does not overwrite a job after cancellation or lease loss", () => {
    expect(
      failureDecision(new Error("Worker lease lost"), 1, 3, now).status,
    ).toBe("lost");
  });
  it("formats eligibility in Philippine time and distinguishes offline from budget waiting", () => {
    expect(philippineTime("2026-10-28T00:00:00Z")).toMatch(
      /Oct 28.*8:00.*AM.*PHT/,
    );
    const job = {
      id: "j",
      status: "queued",
      available_at: "2026-10-28T00:00:00Z",
      wait_reason: "budget",
    } as Job;
    const data = {
      server_time: new Date(now).toISOString(),
      workers: [],
      queue: [],
      blocks: [],
      budgets: {},
    } as unknown as OperationsSnapshot;
    expect(jobPresentation(job, data)).toMatchObject({
      label: "Budget reached",
    });
    expect(
      jobPresentation(
        { ...job, available_at: new Date(now - 1000).toISOString() },
        data,
      ).label,
    ).toBe("Waiting for worker");
    expect(
      jobPresentation(
        { ...job, status: "blocked", error_code: "credentials" },
        data,
      ).label,
    ).toBe("Needs attention");
  });
  it("shows backlog and provider pauses independently from job error text", () => {
    const job = { id: "j", status: "queued" } as Job;
    const data = {
      server_time: new Date(now).toISOString(),
      workers: [],
      queue: [{ id: "j", reason: "backlog" }],
      blocks: [],
      budgets: { max_audit_backlog: 5 },
    } as unknown as OperationsSnapshot;
    expect(jobPresentation(job, data).label).toBe("Waiting for audits");
    data.queue[0] = {
      id: "j",
      reason: "provider",
      provider: "tavily",
      available_at: new Date(now).toISOString(),
    };
    data.blocks = [
      {
        provider: "tavily",
        reason: "Invalid credentials",
        code: "credentials",
        blocked_until: null,
      },
    ];
    expect(jobPresentation(job, data).label).toBe("Provider paused");
  });
});

const memory = vi.hoisted(() => ({ rows: new Map<string, any>() }));
vi.mock("../server/lib/db", () => ({
  checked: async (query: PromiseLike<any>) => {
    const r = await query;
    if (r.error) throw new Error(r.error.message);
    return r.data;
  },
  db: () => ({
    from: () => {
      const f: Record<string, string> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: string) => {
          f[k] = v;
          return q;
        },
        maybeSingle: async () => ({
          data:
            memory.rows.get(`${f.organization_id}:${f.job_id}:${f.step}`) ??
            null,
          error: null,
        }),
      };
      return q;
    },
    rpc: async (_name: string, p: any) => {
      memory.rows.set(`${p.org}:${p.job}:${p.step_name}`, {
        signature: p.request_signature,
        result: p.value,
        saved_at: new Date().toISOString(),
      });
      return { data: null, error: null };
    },
  }),
}));
import { checkpointedPageSpeed } from "../server/lib/checkpoints";
const sample = {
  url: "https://store.example/",
  strategy: "mobile" as const,
  sample: 1,
  tested_at: "2026-10-27T12:00:00Z",
  scores: { performance: 40 },
  diagnostics: {},
  field_data: { available: false, scope: "unavailable" as const, metrics: {} },
};
describe("PageSpeed checkpoint reuse", () => {
  beforeEach(() => memory.rows.clear());
  const job = {
    id: "job",
    organization_id: "org",
    worker_id: "worker",
  } as Job & { organization_id: string; worker_id: string };
  it("reuses a completed measurement after retry without making a provider request", async () => {
    const run = vi.fn(async () => sample),
      checkpoint = vi.fn(async () => {}),
      reuse = vi.fn(async () => {});
    await checkpointedPageSpeed(
      job,
      sample.url,
      "mobile",
      1,
      run,
      checkpoint,
      reuse,
    );
    const result = await checkpointedPageSpeed(
      { ...job, worker_id: "replacement-worker" },
      sample.url,
      "mobile",
      1,
      run,
      checkpoint,
      reuse,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(reuse).toHaveBeenCalledTimes(1);
    expect(result.tested_at).toBe(sample.tested_at);
  });
  it("does not reuse stale, mismatched or other-tenant measurements", async () => {
    const run = vi.fn(async () => sample),
      checkpoint = async () => {},
      reuse = async () => {};
    await checkpointedPageSpeed(
      job,
      sample.url,
      "mobile",
      1,
      run,
      checkpoint,
      reuse,
    );
    const row = memory.rows.get("org:job:pagespeed:mobile:1");
    row.saved_at = new Date(Date.now() - 86400001).toISOString();
    await checkpointedPageSpeed(
      job,
      sample.url,
      "mobile",
      1,
      run,
      checkpoint,
      reuse,
    );
    await checkpointedPageSpeed(
      job,
      "https://store.example/changed",
      "mobile",
      1,
      run,
      checkpoint,
      reuse,
    );
    await checkpointedPageSpeed(
      { ...job, organization_id: "other" },
      sample.url,
      "mobile",
      1,
      run,
      checkpoint,
      reuse,
    );
    expect(run).toHaveBeenCalledTimes(4);
  });
  it("checks ownership before requesting or reusing a measurement", async () => {
    const run = vi.fn(async () => sample);
    await expect(
      checkpointedPageSpeed(
        job,
        sample.url,
        "mobile",
        1,
        run,
        async () => {
          throw new Error("Worker lease lost");
        },
        async () => {},
      ),
    ).rejects.toThrow("lease lost");
    expect(run).not.toHaveBeenCalled();
  });
});
