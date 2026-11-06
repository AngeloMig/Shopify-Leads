import { readFile, writeFile } from "node:fs/promises";
import { checked, db } from "./db.js";
import { postWebhook } from "./alert-webhook.js";
import {
  alertText,
  buildAlerts,
  digestText,
  type Alert,
  type AlertFeed,
  type Digest,
} from "../../shared/alerts.js";
import { defaultSettings } from "../../shared/types.js";

const day = 86400000;
type LocalJobRow = {
  id: string;
  name: string | null;
  search_id: string | null;
  funnel: Record<string, unknown> | null;
  best: { name?: unknown; score?: unknown } | null;
};
/** Everything the alert list and daily digest report, for one workspace. */
export async function workspaceAlerts(
  org: string,
  at = Date.now(),
): Promise<AlertFeed> {
  const since = new Date(at - day).toISOString();
  const [
    workers,
    blocks,
    usage,
    settings,
    failures,
    audits,
    leads,
    review,
    local,
  ] = await Promise.all([
    checked(
      db()
        .from("worker_heartbeats")
        .select("state,last_seen")
        .eq("organization_id", org),
    ),
    checked(
      db()
        .from("provider_blocks")
        .select("provider,reason,blocked_until")
        .eq("organization_id", org),
    ),
    checked(
      db()
        .from("api_usage_daily")
        .select("units,discovery_units,audit_units")
        .eq("organization_id", org)
        .eq("day", new Date(at).toISOString().slice(0, 10))
        .maybeSingle(),
    ),
    checked(
      db()
        .from("app_settings")
        .select("config")
        .eq("organization_id", org)
        .maybeSingle(),
    ),
    checked(
      db()
        .from("automation_jobs")
        .select("id,error")
        .eq("organization_id", org)
        // Blocked jobs have no finish time and need someone until they're resolved.
        .or(
          `status.eq.blocked,and(status.eq.failed,completed_at.gte."${since}")`,
        )
        .order("created_at", { ascending: false })
        .limit(50),
    ),
    db()
      .from("automation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("type", "audit")
      .eq("status", "completed")
      .gte("completed_at", since),
    // The ids go in a URL below, so only the newest are ranked for "top leads".
    db()
      .from("leads")
      .select("id", { count: "exact" })
      .eq("organization_id", org)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100),
    db()
      .from("lead_search_index")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("permission", "unknown")
      .gte("opportunity_rank", 0)
      .is("outcome", null),
    // Local searches that finished today, each with what it found.
    db()
      .from("automation_jobs")
      .select(
        "id,name:payload->config->>name,search_id:payload->>search_id,funnel:payload->funnel,best:payload->best",
      )
      .eq("organization_id", org)
      .eq("type", "discovery")
      .eq("status", "completed")
      .eq("payload->>kind", "local")
      .gte("completed_at", since)
      .order("completed_at", { ascending: false })
      .limit(5),
  ]);
  for (const result of [audits, leads, review, local])
    if (result.error) throw new Error(result.error.message);
  const newIds = (leads.data ?? []).map((l) => l.id);
  const top = newIds.length
    ? await checked(
        db()
          .from("lead_search_index")
          .select("id,business_name,research_score")
          .eq("organization_id", org)
          .in("id", newIds)
          .order("research_score", { ascending: false, nullsFirst: false })
          .limit(3),
      )
    : [];
  const digest: Digest = {
    since,
    new_leads: leads.count ?? newIds.length,
    audits_completed: audits.count ?? 0,
    failed_jobs: failures.length,
    awaiting_review: review.count ?? 0,
    top_leads: top.map((l) => ({
      id: l.id,
      name: l.business_name,
      score: l.research_score,
    })),
    local_searches: ((local.data ?? []) as LocalJobRow[]).map((j) => {
      const n = (key: string) => Number(j.funnel?.[key]) || 0;
      return {
        job_id: j.id,
        search_id: j.search_id,
        name: j.name ?? "your local search",
        no_site: n("saved") - n("site_found"),
        strong: n("strong"),
        best:
          j.best && typeof j.best.name === "string"
            ? { name: j.best.name, score: Number(j.best.score) || 0 }
            : null,
      };
    }),
  };
  return {
    digest,
    alerts: buildAlerts({
      at,
      workers,
      blocks,
      usage: usage ?? {},
      budgets: { ...defaultSettings, ...settings?.config },
      failures,
      digest,
    }),
  };
}

const stateFile = (name: string) =>
  `${process.env.SCOUT_ALERT_STATE_DIR || "/tmp"}/scout-alerts-${name}.json`;
/**
 * Sends new problems and one daily digest to ALERT_WEBHOOK_URL. Off unless that is
 * set. `name` separates the processes sharing this machine, and `include` limits
 * which alerts each sends: a stopped worker can't report that it has stopped.
 */
export async function deliverAlerts(
  name: "worker" | "api",
  include: (alert: Alert) => boolean,
  options: { digest: boolean },
  at = Date.now(),
) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const today = new Date(at).toISOString().slice(0, 10);
  const sent = new Set<string>(
    await readFile(stateFile(name), "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => []),
  );
  const send = async (key: string, text: string) => {
    if (sent.has(key)) return;
    await postWebhook(url, text);
    sent.add(key);
  };
  const digestHour = Number(process.env.ALERT_DIGEST_HOUR_UTC ?? 0);
  try {
    const orgs = await checked(db().from("organizations").select("id,name"));
    for (const org of orgs) {
      const { alerts, digest } = await workspaceAlerts(org.id, at);
      for (const alert of alerts)
        if ((alert.severity !== "info" || alert.notify) && include(alert))
          await send(
            `${org.id}:${alert.key}:${today}`,
            alertText(alert, org.name, process.env.APP_URL),
          );
      if (options.digest && new Date(at).getUTCHours() >= digestHour)
        await send(
          `${org.id}:digest:${today}`,
          digestText(digest, alerts, org.name),
        );
    }
  } finally {
    // Saved even after a failed send, so what did go out isn't repeated. Keeping
    // only today's keys lets a problem that's still there report again tomorrow.
    await writeFile(
      stateFile(name),
      JSON.stringify([...sent].filter((key) => key.endsWith(today))),
      { mode: 0o600 },
    );
  }
}
