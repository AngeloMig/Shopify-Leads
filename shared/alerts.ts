import { workerOnline } from "./automation.js";

export type Alert = {
  /** Stable identity, so one problem is only sent once a day. */
  key: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  path: string;
};
export type Digest = {
  since: string;
  new_leads: number;
  audits_completed: number;
  failed_jobs: number;
  awaiting_review: number;
  top_leads: { id: string; name: string; score: number | null }[];
};
export type AlertFeed = { alerts: Alert[]; digest: Digest };
export type AlertInput = {
  at: number;
  workers: { state: string; last_seen: string }[];
  blocks: { provider: string; reason: string; blocked_until: string | null }[];
  usage: { units?: number; discovery_units?: number; audit_units?: number };
  budgets: {
    daily_api_budget?: number;
    discovery_daily_budget?: number;
    audit_daily_budget?: number;
  };
  failures: { id?: string; error: string | null }[];
  digest: Digest;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** Problems first, then what's worth opening. Only reports what was recorded. */
export function buildAlerts(input: AlertInput): Alert[] {
  const alerts: Alert[] = [];
  if (!input.workers.some((w) => workerOnline(w, input.at)))
    alerts.push({
      key: "worker_offline",
      severity: "critical",
      title: "Worker is offline",
      detail: "Scheduled discovery and audits won't run until it restarts.",
      path: "/jobs",
    });
  for (const block of input.blocks)
    if (!block.blocked_until || Date.parse(block.blocked_until) > input.at)
      alerts.push({
        key: `provider_paused:${block.provider}`,
        severity: "warning",
        title: `${block.provider} is paused`,
        detail: block.reason,
        path: "/jobs",
      });
  const { usage, budgets } = input;
  const reached = (used = 0, limit?: number) =>
    limit !== undefined && used >= limit;
  if (reached(usage.units, budgets.daily_api_budget))
    alerts.push({
      key: "budget_total",
      severity: "warning",
      title: "Daily request budget reached",
      detail: "Paid requests wait until the budget resets at midnight UTC.",
      path: "/settings",
    });
  else
    // A category set to 0 is deliberately paused, not an event to report.
    for (const [kind, used, limit] of [
      ["discovery", usage.discovery_units, budgets.discovery_daily_budget],
      ["audit", usage.audit_units, budgets.audit_daily_budget],
    ] as const)
      if (limit && reached(used, limit))
        alerts.push({
          key: `budget_${kind}`,
          severity: "warning",
          title: `Daily ${kind} budget reached`,
          detail: `${kind === "audit" ? "Audits wait" : "Discovery waits"} until the budget resets at midnight UTC.`,
          path: "/settings",
        });
  if (input.failures.length)
    alerts.push({
      key: "jobs_failed",
      severity: "warning",
      title: `${plural(input.failures.length, "job")} failed or blocked`,
      detail:
        input.failures[0].error?.slice(0, 200) ??
        "Open Automation Jobs for details.",
      path:
        input.failures.length === 1 && input.failures[0].id
          ? `/jobs/${input.failures[0].id}`
          : "/jobs?filter=attention",
    });
  const { new_leads, awaiting_review, top_leads } = input.digest;
  if (new_leads) {
    const best = top_leads[0];
    alerts.push({
      key: "new_leads",
      severity: "info",
      title: `${plural(new_leads, "new lead")} in the last 24 hours`,
      detail: best
        ? `Top: ${best.name}${best.score === null ? "" : ` (${best.score}/100)`}.`
        : "Open Leads to review them.",
      path: "/leads",
    });
  }
  if (awaiting_review)
    alerts.push({
      key: "review_waiting",
      severity: "info",
      title: `${plural(awaiting_review, "lead")} waiting for outreach review`,
      detail: "Check permission and country evidence before outreach.",
      path: "/outreach",
    });
  return alerts;
}
export const alertText = (alert: Alert, workspace: string) =>
  `${alert.severity === "critical" ? "🔴" : "🟠"} ${workspace}: ${alert.title}. ${alert.detail}`;
/** Plain text that reads the same in Slack, Discord and a terminal. */
export function digestText(digest: Digest, alerts: Alert[], workspace: string) {
  const problems = alerts.filter((a) => a.severity !== "info");
  return [
    `Scout daily digest · ${workspace}`,
    `${plural(digest.new_leads, "new lead")} · ${plural(digest.audits_completed, "audit")} completed · ${plural(digest.failed_jobs, "failed job")} · ${digest.awaiting_review} awaiting review`,
    ...(digest.top_leads.length
      ? [
          "Top new leads:",
          ...digest.top_leads.map(
            (l) => `• ${l.name}${l.score === null ? "" : ` (${l.score}/100)`}`,
          ),
        ]
      : []),
    ...(problems.length
      ? ["Needs attention:", ...problems.map((p) => `• ${p.title}`)]
      : []),
  ].join("\n");
}
