import {
  publicActivityUrl,
  readWork,
  workStages,
  type RunDetail,
  type WorkEvent,
  type WorkStage,
} from "./job-activity.js";
export type TaskState =
  | "queued"
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "retrying"
  | "failed"
  | "skipped"
  | "recorded"
  | "interrupted";
export type TaskDescriptor = {
  key: string;
  name: string;
  state?: TaskState;
  parent?: string;
};
export type ResearchTask = {
  id: string;
  stage: WorkStage;
  parent: string;
  name: string;
  state: TaskState;
  url?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  attempt: number;
  events: WorkEvent[];
  latest: WorkEvent;
  facts: NonNullable<WorkEvent["facts"]>;
};
export const taskStatus: Record<TaskState, string> = {
  queued: "Waiting",
  starting: "Starting",
  running: "Running",
  waiting: "Waiting for response",
  completed: "Completed",
  retrying: "Retrying",
  failed: "Failed",
  skipped: "Skipped",
  recorded: "Recorded",
  interrupted: "Interrupted",
};
export const isWorkingTask = (s: TaskState) =>
  ["starting", "running", "waiting"].includes(s);
export const isIssueTask = (s: TaskState) =>
  ["failed", "retrying", "interrupted"].includes(s);
/** Compatibility for retained runs; explicit worker task metadata takes precedence. */
export function inferTask(
  e: Pick<WorkEvent, "stage" | "state" | "message" | "facts" | "url">,
): TaskDescriptor {
  const { stage, facts: f, message: m } = e;
  const url = publicActivityUrl(e.url);
  let key = "summary",
    name: string = workStages[stage];
  if (stage === "measure" && typeof f?.sample === "number") {
    key = `${f.strategy}:${f.sample}`;
    name = `${f.strategy === "desktop" ? "Desktop" : "Mobile"} · sample ${f.sample} of 3`;
  } else if (
    stage === "inspect" &&
    url &&
    /Reading|page checked|Skipped unavailable/.test(m)
  ) {
    key = `page:${url}`;
    name = `Review ${new URL(url).pathname}`;
  } else if (stage === "inspect" && /browser diagnostics/.test(m)) {
    key = "browser";
    name = "Mobile browser diagnostics";
  } else if (stage === "search") {
    key = typeof f?.query === "string" ? `query:${f.query}` : "search";
    name = "Find candidate stores";
  } else if (stage === "verify" && url) {
    key = `store:${new URL(url).hostname}`;
    name = `Verify ${new URL(url).hostname}`;
  } else if (stage === "queue" && url) {
    key = `queue:${new URL(url).hostname}`;
    name = `Queue ${new URL(url).hostname}`;
  } else if (stage === "report") {
    key = /Publishing/.test(m) ? "publish" : "prepare";
    name = /Publishing/.test(m)
      ? "Publish private report"
      : "Prepare audit report";
  }
  const state: TaskState =
    e.state === "completed"
      ? "completed"
      : e.state === "skipped"
        ? "skipped"
        : e.state === "started"
          ? "starting"
          : typeof f?.performance === "number" ||
              f?.reused === true ||
              f?.outcome
            ? "completed"
            : "recorded";
  return { key, name, state };
}
export function researchTasks(detail: RunDetail | null): ResearchTask[] {
  if (!detail) return [];
  const events = readWork(detail.job.payload.work)?.events ?? [];
  const tasks = new Map<string, ResearchTask>();
  for (const e of events) {
    const descriptor = inferTask(e),
      id =
        e.task_id ??
        `${detail.job.id}:${e.attempt}:${e.stage}:${descriptor.key}`;
    const prev = tasks.get(id);
    const facts = { ...prev?.facts, ...e.facts };
    const state = e.task_state ?? descriptor.state ?? "recorded";
    tasks.set(id, {
      id,
      stage: e.stage,
      parent: e.parent_id ?? e.stage,
      name: e.task_name ?? descriptor.name,
      state,
      url: e.url ?? prev?.url,
      startedAt: prev?.startedAt ?? e.at,
      updatedAt: e.at,
      finishedAt: ["completed", "skipped", "failed"].includes(state)
        ? e.at
        : undefined,
      attempt: e.attempt,
      events: [...(prev?.events ?? []), e],
      latest: e,
      facts,
    });
  }
  for (const task of tasks.values()) {
    if (!isWorkingTask(task.state)) continue;
    if (task.attempt < detail.job.attempts) task.state = "interrupted";
    else if (["failed", "blocked"].includes(detail.job.status))
      task.state = "failed";
    else if (detail.job.status === "queued")
      task.state = detail.job.error ? "retrying" : "queued";
    else if (detail.job.status === "cancelled") task.state = "interrupted";
    else if (detail.job.status === "completed") task.state = "recorded"; // Never infer an unobserved result.
  }
  return [...tasks.values()];
}
export function taskForEvent(tasks: ResearchTask[], eventId: string) {
  return tasks.find((t) => t.events.some((e) => e.id === eventId));
}
export function resultSummary(task: ResearchTask) {
  const f = task.facts;
  if (typeof f.performance === "number")
    return `Performance ${f.performance}/100${typeof f.seo === "number" ? ` · SEO ${f.seo}/100` : ""}${f.reused ? " · saved measurement" : ""}`;
  if (typeof f.findings === "number")
    return `${f.findings} findings${typeof f.emails === "number" ? ` · ${f.emails} public emails` : ""}`;
  if (typeof f.status_code === "number")
    return `HTTP ${f.status_code}${f.redirected ? " · redirected" : ""}`;
  if (typeof f.candidates === "number")
    return `${f.candidates} candidate stores`;
  return task.latest.message;
}

/** Completion is observed from the durable finalize transaction, which releases the worker lease. */
export function observedFinalization(
  job: import("./types.js").Job,
  reportId: string | null,
) {
  const work = readWork(job.payload.work);
  if (!work || job.status !== "completed" || !reportId || !job.completed_at)
    return work;
  const last = work.events
    .filter(
      (e) =>
        e.attempt === job.attempts && e.task_id?.endsWith(":report:finalize"),
    )
    .at(-1);
  if (!last || last.task_state === "completed") return work;
  const completed: WorkEvent = {
    ...last,
    id: `${last.task_id}:result`,
    at: job.completed_at,
    state: "completed",
    task_state: "completed",
    message: "Audit finalized; private report ready to open",
    facts: {
      report_available: true,
      observed_from: "completed job and owned report",
    },
  };
  return {
    ...work,
    updated_at: job.completed_at,
    events: [...work.events, completed],
  };
}
