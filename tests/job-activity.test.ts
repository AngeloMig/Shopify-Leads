import { describe, it, expect, vi } from "vitest";
import { jobActivity } from "../server/lib/job-activity";
import {
  publicActivityUrl,
  readWork,
  stageState,
  type JobWork,
} from "../shared/job-activity";
import { previewRun, previewLength } from "../src/components/research-preview";
import type { Job } from "../shared/types";
const fence = vi.hoisted(() => ({ owned: true, filters: [] as unknown[][] }));
vi.mock("../server/lib/db", () => ({
  now: () => new Date().toISOString(),
  checked: async (p: any) => {
    const r = await p;
    if (r.error) throw new Error(r.error.message);
    return r.data;
  },
  db: () => ({
    from: () => {
      const q: any = {
        update: () => q,
        select: () => q,
        eq: (...args: unknown[]) => {
          fence.filters.push(args);
          return q;
        },
        gt: (...args: unknown[]) => {
          fence.filters.push(["gt", ...args]);
          return q;
        },
        maybeSingle: async () => ({
          data: fence.owned ? { id: "job" } : null,
          error: null,
        }),
      };
      return q;
    },
  }),
}));
import { publishJobWork } from "../server/lib/job-activity";
const job = {
  id: "job",
  organization_id: "org",
  worker_id: "worker",
  type: "audit",
  status: "running",
  attempts: 1,
  payload: {},
} as Job & { organization_id: string; worker_id: string };
describe("Recorded research activity", () => {
  it("fences activity writes by workspace, job, worker, running state and current lease", async () => {
    fence.filters = [];
    fence.owned = true;
    await publishJobWork(job, { work: {} });
    expect(fence.filters).toEqual(
      expect.arrayContaining([
        ["organization_id", "org"],
        ["id", "job"],
        ["worker_id", "worker"],
        ["status", "running"],
        ["gt", "lease_until", expect.any(String)],
      ]),
    );
    fence.owned = false;
    await expect(publishJobWork(job, {})).rejects.toThrow("Worker lease lost");
    fence.owned = true;
  });
  it("retains task history and preserves a target while stripping credentials, queries and oversized facts", async () => {
    const snapshots: JobWork[] = [];
    const emit = jobActivity(job, async (w) => {
      snapshots.push(w);
    });
    await emit("verify", "started", "Checking store", {
      target: {
        label: "Example store",
        url: "https://store.example/?token=not-for-the-feed",
        domain: "store.example",
      },
    });
    for (let n = 0; n < 85; n++)
      await emit("measure", "note", `Measurement ${n}`, {
        url: "https://store.example/product?customer=private#tracking",
        facts: { number: n, details: "x".repeat(900), bad: NaN },
      });
    const last = snapshots.at(-1)!;
    expect(last.events).toHaveLength(86);
    expect(last.target.url).toBe("https://store.example/");
    expect(last.events.at(-1)?.url).toBe("https://store.example/product");
    expect(last.events.at(-1)?.facts?.details).toHaveLength(500);
    expect(last.events.at(-1)?.facts).not.toHaveProperty("bad");
    expect(new Set(last.events.map((e) => e.id)).size).toBe(86);
  });
  it("keeps task resource keys public and avoids truncation collisions", async () => {
    let work: JobWork | undefined;
    const emit = jobActivity(job, async (w) => {
      work = w;
    });
    await emit("inspect", "started", "Reading page", {
      task: {
        key: "page:https://store.example/contact?token=private",
        name: "Contact",
        state: "waiting",
      },
    });
    expect(work?.events[0].task_id).toBe(
      "job:1:inspect:page:https://store.example/contact",
    );
    const prefix = "https://store.example/" + "a".repeat(900);
    await emit("inspect", "note", "One", {
      task: { key: prefix + "one", name: "One", state: "completed" },
    });
    await emit("inspect", "note", "Two", {
      task: { key: prefix + "two", name: "Two", state: "completed" },
    });
    expect(work?.events[1].task_id).not.toBe(work?.events[2].task_id);
    expect(work?.events[1].task_id?.length).toBeLessThan(100);
  });
  it("serializes concurrent events without overwriting another task", async () => {
    const snapshots: JobWork[] = [];
    const emit = jobActivity(job, async (w) => {
      await Promise.resolve();
      snapshots.push(w);
    });
    await Promise.all([
      emit("measure", "started", "Mobile sample", {
        task: { key: "mobile:1", name: "Mobile sample 1", state: "waiting" },
      }),
      emit("inspect", "started", "Contact page", {
        task: { key: "contact", name: "Contact page", state: "running" },
      }),
    ]);
    expect(snapshots.at(-1)?.events).toHaveLength(2);
    expect(new Set(snapshots.at(-1)?.events.map((e) => e.task_id)).size).toBe(
      2,
    );
  });
  it("does not retain an event if its ownership-fenced publication fails", async () => {
    const publish = vi
        .fn()
        .mockRejectedValueOnce(new Error("Worker lease lost"))
        .mockResolvedValue(undefined),
      emit = jobActivity(job, publish);
    await expect(emit("verify", "started", "Lost event")).rejects.toThrow(
      "lease lost",
    );
    await emit("verify", "started", "Committed event");
    expect(publish.mock.calls[1][0].events.map((e: any) => e.message)).toEqual([
      "Committed event",
    ]);
  });
  it("does not invent stage completion for old runs and distinguishes blocked and cancelled stages", async () => {
    expect(stageState({ ...job, status: "completed" }, "measure")).toBe(
      "pending",
    );
    let work: JobWork | undefined;
    await jobActivity(job, async (w) => {
      work = w;
    })("report", "started", "Publishing PDF");
    const traced = { ...job, payload: { work } };
    expect(stageState(traced, "report")).toBe("active");
    expect(stageState({ ...traced, status: "blocked" }, "report")).toBe(
      "attention",
    );
    expect(stageState({ ...traced, status: "cancelled" }, "report")).toBe(
      "cancelled",
    );
    expect(stageState({ ...traced, status: "completed" }, "report")).toBe(
      "completed",
    );
  });
  it("does not mark an entire stage skipped when one optional task is unavailable", async () => {
    let work: JobWork | undefined;
    const emit = jobActivity(job, async (w) => {
      work = w;
    });
    await emit("inspect", "started", "Reviewing representative pages");
    await emit("inspect", "skipped", "Contact page disallows crawling", {
      task: { key: "contact", name: "Contact page", state: "skipped" },
    });
    expect(stageState({ ...job, payload: { work } }, "inspect")).toBe("active");
  });
  it("rejects malformed activity and unsafe public links", () => {
    expect(publicActivityUrl("javascript:alert(1)")).toBeUndefined();
    expect(
      publicActivityUrl("https://user:password@store.example"),
    ).toBeUndefined();
    expect(
      readWork({
        version: 1,
        target: { label: "test" },
        stage: "toString",
        events: [],
      }),
    ).toBeNull();
    expect(
      readWork({
        version: 1,
        target: { label: "test" },
        stage: "measure",
        events: [
          {
            id: "bad",
            stage: "measure",
            state: "started",
            at: "not-a-date",
            message: "bad",
          },
        ],
      })?.events,
    ).toEqual([]);
  });
  it("keeps previews deterministic, fictional and independent of live provider requests", () => {
    for (const type of ["audit", "discovery"] as const) {
      const first = previewRun(type, 0, 0),
        done = previewRun(type, previewLength(type) - 1, 0);
      expect(first.job.status).toBe("running");
      expect(done.job.status).toBe("completed");
      expect(done.job.api_usage).toEqual({});
      expect(done.target.domain).toMatch(/\.example$/);
      expect(readWork(done.job.payload.work)?.events.length).toBe(
        previewLength(type),
      );
    }
    expect(
      previewRun("audit", previewLength("audit") - 1, 0).measurements,
    ).toHaveLength(6);
  });
});
