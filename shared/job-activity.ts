import type { Job } from "./types.js";
export const workStages = {
  prepare: "Prepare run",
  search: "Find candidates",
  verify: "Verify storefront",
  queue: "Queue audits",
  measure: "Measure performance",
  inspect: "Review pages",
  report: "Build report",
} as const;
export type WorkStage = keyof typeof workStages;
export type WorkEvent = {
  id: string;
  at: string;
  attempt: number;
  stage: WorkStage;
  state: "started" | "completed" | "skipped" | "note";
  message: string;
  url?: string;
  scope?: "stage" | "task";
  task_id?: string;
  parent_id?: string;
  task_name?: string;
  task_state?: import("./research-tasks.js").TaskState;
  facts?: Record<string, string | number | boolean | null>;
};
export type WorkTarget = {
  label: string;
  domain?: string;
  url?: string;
  audit_id?: string;
};
export type JobWork = {
  version: 1;
  stage: WorkStage;
  updated_at: string;
  target: WorkTarget;
  events: WorkEvent[];
};
export type RunDetail = {
  job: Job;
  target: WorkTarget;
  server_time: string;
  pages: { url: string; kind: string; status_code: number | null }[];
  measurements: {
    strategy: string;
    sample: number;
    tested_at: string;
    scores: Record<string, number | null>;
  }[];
  findings: {
    title: string;
    category: string;
    severity: string;
    url: string;
  }[];
  report_id: string | null;
};
export function publicActivityUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      return undefined;
    u.search = "";
    u.hash = "";
    return u.href;
  } catch {
    return undefined;
  }
}
export function readWork(value: unknown): JobWork | null {
  if (!value || typeof value !== "object") return null;
  const w = value as JobWork;
  if (
    w.version !== 1 ||
    !w.target ||
    typeof w.target.label !== "string" ||
    !Array.isArray(w.events) ||
    !Object.hasOwn(workStages, w.stage)
  )
    return null;
  const events = w.events
    .filter(
      (e) =>
        e &&
        typeof e.id === "string" &&
        typeof e.message === "string" &&
        Object.hasOwn(workStages, e.stage) &&
        ["started", "completed", "skipped", "note"].includes(e.state) &&
        Number.isFinite(Date.parse(e.at)),
    )
    .map((e) => ({
      ...e,
      message: e.message.slice(0, 600),
      url: publicActivityUrl(e.url),
      scope: e.scope === "task" || e.scope === "stage" ? e.scope : undefined,
      task_id:
        typeof e.task_id === "string" ? e.task_id.slice(0, 800) : undefined,
      task_name:
        typeof e.task_name === "string" ? e.task_name.slice(0, 200) : undefined,
      parent_id:
        typeof e.parent_id === "string" ? e.parent_id.slice(0, 800) : undefined,
      task_state: [
        "queued",
        "starting",
        "running",
        "waiting",
        "completed",
        "retrying",
        "failed",
        "skipped",
        "recorded",
        "interrupted",
      ].includes(e.task_state ?? "")
        ? e.task_state
        : undefined,
    }));
  return {
    ...w,
    target: {
      ...w.target,
      label: w.target.label.slice(0, 200),
      url: publicActivityUrl(w.target.url),
    },
    events,
  };
}
/** Only the events job lists read: the latest one, and what `stageState` looks at. */
export function listWork(value: unknown, attempt: number): JobWork | null {
  const work = readWork(value);
  if (!work) return null;
  const kept = new Map<WorkStage, WorkEvent>();
  for (const e of work.events)
    if (e.attempt === attempt && e.scope !== "task") kept.set(e.stage, e);
  const latest = work.events.at(-1);
  return {
    ...work,
    events: work.events.filter((e) => e === latest || kept.get(e.stage) === e),
  };
}
export const stagesFor = (type: Job["type"]): WorkStage[] =>
  type === "discovery"
    ? ["prepare", "search", "verify", "queue"]
    : ["verify", "measure", "inspect", "report"];
export function stageState(job: Job, stage: WorkStage) {
  const work = readWork(job.payload.work);
  const events =
    work?.events.filter(
      (e) =>
        e.stage === stage && e.attempt === job.attempts && e.scope !== "task",
    ) ?? [];
  const last = events.at(-1);
  if (last?.state === "skipped") return "skipped";
  if (job.status === "cancelled" && work?.stage === stage) return "cancelled";
  if (["failed", "blocked"].includes(job.status) && work?.stage === stage)
    return "attention";
  if (last?.state === "completed") return "completed";
  if (job.status === "completed" && work?.stage === stage && last)
    return "completed";
  if (work?.stage === stage && job.status === "running") return "active";
  return last ? "recorded" : "pending";
}
export function targetFor(job: Job): WorkTarget {
  const work = readWork(job.payload.work);
  if (work) return work.target;
  const target = job.payload.display_target as WorkTarget | undefined;
  if (target && typeof target.label === "string")
    return { ...target, url: publicActivityUrl(target.url) };
  return {
    label:
      typeof job.payload.name === "string"
        ? job.payload.name
        : job.type === "discovery"
          ? "Store discovery"
          : "Website audit",
  };
}
