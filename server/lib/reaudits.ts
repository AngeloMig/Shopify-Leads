// Monthly re-audits: good leads you haven't contacted yet are tested again
// every 30 days, so timing signals (a score drop, new products, a new tool)
// can appear. A few per day, so PageSpeed budgets stay for new research.
import { db, checked } from "./db.js";
import { enqueue } from "../pipeline.js";

export const reauditDays = 30;
export const reauditsPerDay = 3;
/** Research score from which a lead is worth watching: Priority A and B. */
export const reauditMinScore = 50;

export type ReauditCandidate = {
  store_id: string;
  research_score: number | null;
  audited_at: string | null;
  contacted: boolean;
  closed: boolean;
  suppressed: boolean;
  active_job: boolean;
};
/** Who to re-test today: the strongest stale leads first, up to the cap. */
export function dueForReaudit(
  leads: ReauditCandidate[],
  now = Date.now(),
  room = reauditsPerDay,
) {
  return leads
    .filter(
      (l) =>
        !l.contacted &&
        !l.closed &&
        !l.suppressed &&
        !l.active_job &&
        (l.research_score ?? 0) >= reauditMinScore &&
        !!l.audited_at &&
        now - Date.parse(l.audited_at) >= reauditDays * 86400000,
    )
    .sort((a, b) => (b.research_score ?? 0) - (a.research_score ?? 0))
    .slice(0, Math.max(0, room));
}

/** Queue today's re-audits for every workspace. Safe to call repeatedly. */
export async function queueMonthlyReaudits(
  now = new Date(),
  { dryRun = false } = {},
) {
  const today = now.toISOString().slice(0, 10);
  const orgs = await checked(db().from("organizations").select("id"));
  let queued = 0;
  const picked: string[] = [];
  for (const { id: org } of orgs) {
    const [leads, scores, audits, touched, suppressed, jobs, queries] =
      await Promise.all([
        checked(
          db()
            .from("leads")
            .select("id,store_id,outcome,store:discovered_stores(domain)")
            .eq("organization_id", org),
        ),
        checked(
          db()
            .from("lead_scores")
            .select("store_id,breakdown,created_at")
            .eq("organization_id", org)
            .order("created_at", { ascending: false })
            .limit(5000),
        ),
        checked(
          db()
            .from("audit_runs")
            .select("store_id,completed_at")
            .eq("organization_id", org)
            .eq("status", "completed")
            .order("completed_at", { ascending: false })
            .limit(5000),
        ),
        checked(
          db()
            .from("lead_activities")
            .select("lead_id")
            .eq("organization_id", org)
            .eq("action", "contact_logged")
            .limit(5000),
        ),
        checked(
          db()
            .from("suppression_list")
            .select("domain")
            .eq("organization_id", org),
        ),
        checked(
          db()
            .from("automation_jobs")
            .select("payload,status,created_at")
            .eq("organization_id", org)
            .eq("type", "audit")
            .or(`status.in.(queued,running,blocked),created_at.gte.${today}`)
            .limit(2000),
        ),
        checked(
          db()
            .from("discovery_queries")
            .select("config")
            .eq("organization_id", org)
            .order("created_at")
            .limit(1),
        ),
      ]);
    const config = queries[0]?.config;
    if (!config) continue;
    const latest = <T extends { store_id: string }>(rows: T[]) => {
      const m = new Map<string, T>();
      for (const r of rows) if (!m.has(r.store_id)) m.set(r.store_id, r);
      return m;
    };
    const score = latest(scores),
      audited = latest(audits);
    const contacted = new Set(touched.map((t) => t.lead_id));
    const blocked = new Set(suppressed.map((s) => s.domain));
    const active = new Set(
      jobs
        .filter((j) => ["queued", "running", "blocked"].includes(j.status))
        .map((j) => j.payload?.store_id),
    );
    const doneToday = jobs.filter(
      (j) => j.payload?.reaudit === true && j.created_at >= today,
    ).length;
    const due = dueForReaudit(
      leads.map((l) => ({
        store_id: l.store_id,
        research_score: score.get(l.store_id)?.breakdown?.researchScore ?? null,
        audited_at: audited.get(l.store_id)?.completed_at ?? null,
        contacted: contacted.has(l.id),
        closed: !!l.outcome,
        suppressed: blocked.has(
          (l.store as unknown as { domain?: string } | null)?.domain ?? "",
        ),
        active_job: active.has(l.store_id),
      })),
      now.getTime(),
      reauditsPerDay - doneToday,
    );
    picked.push(...due.map((d) => d.store_id));
    if (dryRun) continue;
    for (const lead of due)
      if (
        await enqueue(org, "audit", `audit:${lead.store_id}`, {
          store_id: lead.store_id,
          config,
          reaudit: true,
        })
      )
        queued++;
  }
  return dryRun ? picked.length : queued;
}
