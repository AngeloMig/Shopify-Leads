import { targetFor } from "./job-activity.js";
import type { Job } from "./types.js";
export type OperationsSnapshot = {
  server_time: string;
  workers: {
    worker_id: string;
    last_seen: string;
    state: string;
    job_id: string | null;
  }[];
  usage: { units: number; discovery_units: number; audit_units: number };
  budgets: {
    daily_api_budget?: number;
    discovery_daily_budget?: number;
    audit_daily_budget?: number;
    max_audit_backlog?: number;
    scheduled_runs_per_day?: number;
  };
  blocks: {
    provider: string;
    reason: string;
    code: string;
    blocked_until: string | null;
  }[];
  queue: {
    id: string;
    reason: string;
    provider: string | null;
    available_at: string;
  }[];
  schedules: {
    id: string;
    name: string;
    enabled: boolean;
    next_run_at: string;
    interval_hours: number;
  }[];
  summary: {
    since: string;
    store_tracking_since: string;
    stores_found: number;
    audits_completed: number;
    new_leads: number;
    leads_with_email: number;
    previously_researched: number;
    duplicate_results: number;
    duplicate_tracking_searches: number;
    searches_total: number;
    failures: number;
    needs_attention: number;
    audit_backlog: number;
  };
};
export const philippineTime = (value: string) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value)) + " PHT";
export const workerOnline = (
  worker: { state: string; last_seen: string },
  at: number,
) => worker.state !== "stopped" && at - Date.parse(worker.last_seen) < 90000;
export function onlineWorkers(data: OperationsSnapshot | null) {
  return (
    data?.workers.filter((w) =>
      workerOnline(w, Date.parse(data.server_time)),
    ) ?? []
  );
}
export function jobPresentation(job: Job, data: OperationsSnapshot | null) {
  const active = onlineWorkers(data),
    processing = active.some((w) => w.state !== "paused");
  if (job.status === "completed") return { label: "Completed", detail: "" };
  if (job.status === "cancelled") return { label: "Cancelled", detail: "" };
  if (job.status === "failed")
    return {
      label: "Failed",
      detail:
        "Scout tried several times and stopped. Check what went wrong, then resume.",
    };
  if (job.status === "blocked")
    return {
      label: "Needs attention",
      detail:
        job.error_code === "credentials"
          ? "Correct the provider configuration, then resume the provider."
          : "Review the source or configuration before resuming.",
    };
  if (job.status === "running")
    return data && !processing
      ? {
          label: "Worker connection lost",
          detail: "The job remains recoverable when the worker returns.",
        }
      : { label: "Running", detail: "" };
  const queued = data?.queue.find((q) => q.id === job.id);
  const available = queued?.available_at ?? job.available_at;
  const future =
    available &&
    Date.parse(available) >
      Date.parse(data?.server_time ?? new Date().toISOString());
  const provider = data?.blocks.find(
    (b) =>
      b.provider === (queued?.provider ?? job.error_provider) &&
      (!b.blocked_until ||
        Date.parse(b.blocked_until) > Date.parse(data.server_time)),
  );
  if (queued?.reason === "provider" || provider)
    return {
      label: "Provider paused",
      detail: provider?.blocked_until
        ? `Eligible ${philippineTime(provider.blocked_until)}.`
        : "Provider configuration needs attention before requests can continue.",
    };
  if (future)
    return {
      label:
        queued?.reason === "budget" ||
        job.wait_reason === "budget" ||
        /budget exhausted/i.test(job.error ?? "")
          ? "Budget reached"
          : job.error_code === "rate_limit"
            ? "Rate limited"
            : job.wait_reason === "retry"
              ? "Retry scheduled"
              : "Scheduled",
      detail: `Eligible ${philippineTime(available!)}.`,
    };
  if (queued?.reason === "backlog")
    return {
      label: "Waiting for audits",
      detail: `Discovery resumes when the audit queue falls below ${data?.budgets.max_audit_backlog ?? 5}.`,
    };
  if (!data)
    return { label: "Queued", detail: "Checking worker availability…" };
  if (!processing)
    return {
      label: active.length ? "Worker paused" : "Waiting for worker",
      detail: "Queued work is retained. The Mac must be awake and online.",
    };
  return {
    label: "Queued",
    detail: active.some((w) => w.state === "working")
      ? "Waiting for the current job to finish."
      : "Ready for the worker.",
  };
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** Blocked jobs wait for someone; failures stop nagging after a day, like alerts. */
export const needsAttention = (job: Job, at: number) =>
  job.status === "blocked" ||
  (job.status === "failed" &&
    !!job.completed_at &&
    at - Date.parse(job.completed_at) < 86400000);
export type AutomationStatus = {
  tone: "loading" | "first" | "idle" | "running" | "waiting" | "problem";
  title: string;
  detail: string;
  action: "watch" | "attention" | "worker" | null;
};
/** The one sentence that answers "is Scout working, and what do I do next?" */
export function automationStatus(
  jobs: Job[],
  data: OperationsSnapshot | null,
): AutomationStatus {
  if (!data)
    return {
      tone: "loading",
      title: "Checking Scout…",
      detail: "Loading status and usage.",
      action: null,
    };
  const at = Date.parse(data.server_time);
  const online = onlineWorkers(data),
    running = jobs.filter((j) => j.status === "running"),
    queued = jobs.filter((j) => j.status === "queued"),
    attention = jobs.filter((j) => needsAttention(j, at));
  if (!online.length)
    return {
      tone: "problem",
      title: "Worker is offline",
      detail:
        running.length + queued.length
          ? `${plural(running.length + queued.length, "job")} will wait until it's back.`
          : "Scheduled runs won't start until it's back.",
      action: "worker",
    };
  if (online.every((w) => w.state === "paused"))
    return {
      tone: "waiting",
      title: "Worker is paused",
      detail: "Queued jobs wait until it resumes.",
      action: null,
    };
  if (running[0]) {
    const label = targetFor(running[0]).label;
    return {
      tone: "running",
      title:
        running[0].type === "discovery"
          ? `Finding stores: ${label}`
          : `Auditing ${label}`,
      detail:
        [
          queued.length && `${queued.length} more waiting`,
          attention.length &&
            `${attention.length} need${attention.length === 1 ? "s" : ""} attention`,
        ]
          .filter(Boolean)
          .join(" · ") || "Scout keeps working with this page closed.",
      action: "watch",
    };
  }
  if (attention.length)
    return {
      tone: "problem",
      title: `${plural(attention.length, "job")} need${attention.length === 1 ? "s" : ""} attention`,
      detail: "Review them below, then resume or cancel.",
      action: "attention",
    };
  if (queued[0]) {
    const next = jobPresentation(queued[0], data);
    return {
      tone: "waiting",
      title: `${plural(queued.length, "job")} waiting: ${next.label.toLowerCase()}`,
      detail: next.detail,
      action: null,
    };
  }
  if (!jobs.length)
    return {
      tone: "first",
      title: "Scout hasn't run yet",
      detail: "Start a discovery to find your first stores.",
      action: null,
    };
  const next = data.schedules
    .filter((s) => s.enabled)
    .map((s) => s.next_run_at)
    .sort()[0];
  return {
    tone: "idle",
    title: "Scout is ready",
    detail: next
      ? `Next run ${philippineTime(next)}.`
      : "No runs scheduled. Start one any time.",
    action: null,
  };
}
