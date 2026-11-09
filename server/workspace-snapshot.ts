import { db, checked } from "./lib/db.js";
import {
  readContactLog,
  readContactPeople,
  type ContactRow,
} from "../shared/contact-log.js";
import { trackerFreeAuditsUrl, trackerInboxUrl } from "./lib/tracker-sync.js";
import { leadScore } from "../shared/lead-score.js";
import { shortBusinessName } from "../shared/lead-intelligence.js";
import { listWork } from "../shared/job-activity.js";
import type { AuditRequest, Finding, Lead } from "../shared/types.js";

/** Lists read a lead's score and labels; only an opened lead needs its evidence. */
export type LeadEvidence = "summary" | "full";
const noId = "00000000-0000-0000-0000-000000000000";
const summaryFindingColumns =
  "id,audit_id,category,title,severity,confidence,kind";
const scoreColumns =
  "audit_id,technical_seo,performance,desktop,modernization,cro,created_at,catalog:breakdown->catalog,fit:breakdown->fit,timing:breakdown->timing,mail:breakdown->mail,brand:breakdown->brand";
const jobColumns =
  "id,type,status,available_at,wait_reason,error_code,error_provider,progress,created_at,started_at,completed_at,error,attempts,max_attempts,api_usage,funnel:payload->funnel,result:payload->result,store_id:payload->store_id,query_id:payload->query_id,resumed_samples:payload->resumed_samples,name:payload->name,kind:payload->kind,work_version:payload->work->version,work_stage:payload->work->stage,work_updated_at:payload->work->updated_at,work_target:payload->work->target";
const payloadKeys = [
  "funnel",
  "result",
  "store_id",
  "query_id",
  "resumed_samples",
  "name",
  "kind",
];
async function readPages(
  makePage: (
    start: number,
    end: number,
  ) => PromiseLike<{
    data: Record<string, any>[] | null;
    error: { message: string } | null;
  }>,
) {
  const rows: Record<string, any>[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const page = await checked(makePage(offset, offset + 499));
    rows.push(...page);
    if (page.length < 500) return rows;
  }
  throw new Error(
    "Research window contains too much evidence to load; reduce the window.",
  );
}
export async function loadLeads(
  org: string,
  ids: string[] | undefined,
  evidence: LeadEvidence,
) {
  let leadQuery = db()
    .from("leads")
    .select("*,store:discovered_stores(*)")
    .eq("organization_id", org)
    .order("updated_at", { ascending: false });
  if (ids) leadQuery = leadQuery.in("id", ids.length ? ids : [noId]);
  const leadRows = await checked(leadQuery.limit(ids ? 100 : 500));
  const storeIds = leadRows.length ? leadRows.map((l) => l.store_id) : [noId];
  const auditIds = leadRows.length ? leadRows.map((l) => l.audit_id) : [noId];
  const stores = leadRows.flatMap((l) => (l.store ? [l.store] : []));
  const domains = stores.length
    ? stores.map((s) => s.domain)
    : ["no-loaded-domain.invalid"];
  const leadIds = leadRows.length ? leadRows.map((l) => l.id) : [noId];
  const [
    scores,
    findings,
    recs,
    reports,
    reviews,
    suppression,
    contacts,
    touches,
  ] = await Promise.all([
    checked(
      db()
        .from("lead_scores")
        .select(scoreColumns)
        .eq("organization_id", org)
        .in("audit_id", auditIds)
        .order("created_at", { ascending: false })
        .limit(5000),
    ) as Promise<Record<string, any>[]>,
    readPages((start, end) =>
      db()
        .from("audit_findings")
        .select(evidence === "full" ? "*" : summaryFindingColumns)
        .eq("organization_id", org)
        .in("audit_id", auditIds)
        .order("id")
        .range(start, end),
    ),
    evidence === "full"
      ? readPages((start, end) =>
          db()
            .from("ai_recommendations")
            .select("*")
            .eq("organization_id", org)
            .in("audit_id", auditIds)
            .order("id")
            .range(start, end),
        )
      : [],
    checked(
      db()
        .from("reports")
        .select("id,audit_id")
        .eq("organization_id", org)
        .in("audit_id", auditIds)
        .order("created_at", { ascending: false })
        .limit(5000),
    ),
    readPages((start, end) =>
      db()
        .from("contact_permission_reviews")
        .select("*")
        .eq("organization_id", org)
        .in("store_id", storeIds)
        .order("reviewed_at", { ascending: false })
        .order("id")
        .range(start, end),
    ),
    checked(
      db()
        .from("suppression_list")
        .select("domain")
        .eq("organization_id", org)
        .in("domain", domains),
    ),
    readPages((start, end) =>
      db()
        .from("contacts")
        .select("*")
        .eq("organization_id", org)
        .in("store_id", storeIds)
        .order("verified_at", { ascending: false })
        .order("id")
        .range(start, end),
    ),
    // Every time you got in touch, for each lead's latest contact.
    checked(
      db()
        .from("lead_activities")
        .select("lead_id,action,details,created_at")
        .eq("organization_id", org)
        .in("action", ["contact_logged", "contact_person", "sent_to_tracker"])
        .in("lead_id", leadIds)
        .limit(5000),
    ) as Promise<(ContactRow & { action: string })[]>,
  ]);
  const contactLog = readContactLog(
    touches.filter((t) => t.action === "contact_logged"),
  );
  const inTracker = new Map(
    touches
      .filter((t) => t.action === "sent_to_tracker")
      .map((t) => [
        t.lead_id,
        String(
          (t.details as { inquiry_id?: unknown } | null)?.inquiry_id ?? "",
        ),
      ]),
  );
  const people = readContactPeople(
    touches.filter((t) => t.action === "contact_person") as never,
  );
  return leadRows
    .map((l): Lead | null => {
      const s = l.store;
      if (!s) return null;
      const sc = scores.find((s) => s.audit_id === l.audit_id);
      const permission = reviews.find((r) => r.store_id === s.id);
      const blocked = suppression.some((x) => x.domain === s.domain);
      const approved =
        permission?.status === "approved" &&
        new Date(permission.expires_at) > new Date();
      const leadFindings = findings
        .filter((f) => f.audit_id === l.audit_id)
        .map((f) =>
          evidence === "full"
            ? f
            : {
                ...f,
                audit_id: undefined,
                url: "",
                evidence: "",
                recommendation: "",
              },
        ) as Finding[];
      const emails = contacts
        .filter(
          (contact) =>
            contact.store_id === s.id &&
            /^mailto:[^?\s]+@[^?\s]+$/i.test(contact.route),
        )
        .map((contact) => ({
          email: contact.route.slice(7),
          source_url: contact.source_url,
          observed_at: contact.verified_at,
        }))
        .filter(
          (contact, index, all) =>
            all.findIndex(
              (other) =>
                other.email.toLowerCase() === contact.email.toLowerCase(),
            ) === index,
        );
      // Scored on read from retained evidence, so older leads get the same rules.
      const catalog = sc?.catalog ?? null;
      const fit = sc?.fit ?? null;
      const timing = sc?.timing ?? [];
      const mail = sc?.mail ?? {};
      const priority = leadScore({
        findings: leadFindings,
        performance: sc?.performance ?? null,
        activity: s.activity ?? null,
        emails,
        mail,
        domain: s.domain,
        title: s.name,
        brand_evidence: sc?.brand ?? null,
        contact_url: s.contact_url,
        catalog,
        fit,
        timing,
        countryVerified: !!s.country && !!s.country_evidence,
        shopifyVerified: s.shopify_verified,
        permissionApproved: approved,
        suppressed: blocked,
      });
      return {
        id: l.id,
        store_id: s.id,
        domain: s.domain,
        name: s.display_name || shortBusinessName(s.name, s.domain),
        original_name: s.name,
        display_name: s.display_name,
        preferred_email: s.preferred_email,
        industry_confidence: s.industry_confidence,
        industry_evidence: s.industry_evidence,
        country: s.country,
        country_evidence: s.country_evidence,
        industry: s.industry,
        activity: s.activity,
        seo: sc?.technical_seo ?? null,
        performance: sc?.performance ?? null,
        desktop: sc?.desktop ?? null,
        modernization: sc?.modernization ?? null,
        cro: sc?.cro ?? null,
        priority: priority.priority,
        stage: blocked ? "suppressed" : l.stage,
        audited_at: sc?.created_at ?? null,
        report_id: reports.find((r) => r.audit_id === l.audit_id)?.id,
        shopify_verified: s.shopify_verified,
        findings: leadFindings,
        ...(evidence === "full"
          ? {
              recommendations: recs
                .filter((r) => r.audit_id === l.audit_id)
                .map((r) => r.recommendation),
            }
          : { evidence_summary: true as const }),
        notes: l.notes,
        owner: l.owner,
        contact_url: s.contact_url,
        emails,
        catalog,
        fit,
        timing_signals: timing,
        brand_evidence: sc?.brand ?? null,
        mail_checks: mail,
        outcome: l.outcome ?? null,
        outcome_reason: l.outcome_reason ?? null,
        outcome_at: l.outcome_at ?? null,
        contact: contactLog.get(l.id) ?? null,
        contact_person: people.get(l.id) ?? null,
        tracker: inTracker.get(l.id)
          ? { inquiry_id: inTracker.get(l.id)!, url: trackerInboxUrl() }
          : null,
        requested: s.source_provider === "audit-request",
        permission: approved
          ? "approved"
          : permission?.status === "rejected"
            ? "rejected"
            : "unknown",
        suppressed: blocked,
      };
    })
    .filter((l): l is Lead => l !== null);
}
/** Store ids added by "Audit a website" or a free-audit request. */
export async function requestedStoreIds(org: string): Promise<string[]> {
  const rows = await checked(
    db()
      .from("discovered_stores")
      .select("id")
      .eq("organization_id", org)
      .eq("source_provider", "audit-request")
      .limit(2000),
  );
  return rows.map((r) => r.id as string);
}

/**
 * Free audits: the latest requested audit of each website, newest first,
 * with its finished audit when there is one.
 */
export async function loadRequests(
  org: string,
  leads: Lead[],
): Promise<AuditRequest[]> {
  const jobs = await checked(
    db()
      .from("automation_jobs")
      .select(
        "id,status,error,created_at,store_id:payload->>store_id,inquiry:payload->>tracker_inquiry_id",
      )
      .eq("organization_id", org)
      .eq("type", "audit")
      .eq("payload->>requested", "true")
      .order("created_at", { ascending: false })
      .limit(300),
  );
  const latest = new Map<string, Record<string, any>>();
  for (const j of jobs) if (!latest.has(j.store_id)) latest.set(j.store_id, j);
  if (!latest.size) return [];
  const stores = await checked(
    db()
      .from("discovered_stores")
      .select("id,domain")
      .eq("organization_id", org)
      .in("id", [...latest.keys()]),
  );
  return [...latest.values()].flatMap((j) => {
    const store = stores.find((s) => s.id === j.store_id);
    if (!store) return [];
    return [
      {
        store_id: store.id,
        domain: store.domain,
        job_id: j.id,
        requested_at: j.created_at,
        status: j.status,
        error: j.error ?? null,
        tracker: j.inquiry
          ? { inquiry_id: j.inquiry, url: trackerFreeAuditsUrl() }
          : null,
        lead: leads.find((l) => l.store_id === store.id) ?? null,
      },
    ];
  });
}

/** Finished jobs skip their event logs here; a run's page loads its own in full. */
async function loadJobs(org: string) {
  const [jobs, active] = await Promise.all([
    checked(
      db()
        .from("automation_jobs")
        .select(jobColumns)
        .eq("organization_id", org)
        .order("created_at", { ascending: false })
        .limit(100),
    ) as Promise<Record<string, any>[]>,
    checked(
      db()
        .from("automation_jobs")
        .select("id,work:payload->work")
        .eq("organization_id", org)
        .in("status", ["running", "queued"])
        .order("created_at", { ascending: false })
        .limit(100),
    ) as Promise<Record<string, any>[]>,
  ]);
  const storeIds = [
    ...new Set(
      jobs
        .map((j) => j.store_id)
        .filter(
          (id: unknown) =>
            typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id as string),
        ),
    ),
  ];
  const stores = storeIds.length
    ? await checked(
        db()
          .from("discovered_stores")
          .select("id,name,display_name,domain")
          .eq("organization_id", org)
          .in("id", storeIds),
      )
    : [];
  return { jobs, active, stores };
}
export async function snapshot(org: string) {
  const [
    leads,
    { jobs, active, stores: jobStores },
    queries,
    organization,
    workspaceSettings,
    totalCount,
    verifiedCount,
    activeCount,
    failedCount,
    reportCount,
  ] = await Promise.all([
    loadLeads(org, undefined, "summary"),
    loadJobs(org),
    checked(
      db().from("discovery_queries").select("*").eq("organization_id", org),
    ),
    checked(db().from("organizations").select("*").eq("id", org).single()),
    checked(
      db()
        .from("app_settings")
        .select("config")
        .eq("organization_id", org)
        .maybeSingle(),
    ),
    db()
      .from("discovered_stores")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", org),
    db()
      .from("discovered_stores")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("shopify_verified", true),
    db()
      .from("discovered_stores")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", org)
      .gte("activity", 50),
    db()
      .from("audit_runs")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("status", "failed"),
    db()
      .from("reports")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", org),
  ]);
  for (const result of [
    totalCount,
    verifiedCount,
    activeCount,
    failedCount,
    reportCount,
  ])
    if (result.error) throw new Error(result.error.message);
  const budgets = workspaceSettings?.config ?? {};
  const requests = await loadRequests(org, leads);
  return {
    // Prospects only: requested audits have their own page.
    leads: leads.filter((l) => !l.requested),
    requests,
    jobs: jobs.map((j) => {
      const store = jobStores.find((s) => s.id === j.store_id);
      const query = queries.find((q) => q.id === j.query_id);
      const work = listWork(
        active.find((a) => a.id === j.id)?.work ?? {
          version: j.work_version,
          stage: j.work_stage,
          updated_at: j.work_updated_at,
          target: j.work_target,
          events: [],
        },
        j.attempts,
      );
      return {
        id: j.id,
        type: j.type,
        status: j.status,
        available_at: j.available_at,
        wait_reason: j.wait_reason,
        error_code: j.error_code,
        error_provider: j.error_provider,
        progress: j.progress,
        created_at: j.created_at,
        started_at: j.started_at,
        completed_at: j.completed_at,
        error: j.error,
        attempts: j.attempts,
        max_attempts: j.max_attempts,
        api_usage: j.api_usage,
        payload: {
          ...Object.fromEntries(
            payloadKeys
              .filter((key) => j[key] !== null)
              .map((key) => [key, j[key]]),
          ),
          ...(work ? { work } : {}),
          display_target: store
            ? {
                label: store.display_name || store.name,
                domain: store.domain,
                url: `https://${store.domain}/`,
              }
            : query
              ? { label: query.name }
              : undefined,
        },
      };
    }),
    settings: queries.map((q) => ({
      ...q.config,
      ...Object.fromEntries(
        [
          "daily_api_budget",
          "discovery_daily_budget",
          "audit_daily_budget",
          "max_audit_backlog",
          "scheduled_runs_per_day",
        ]
          .filter((key) => budgets[key] !== undefined)
          .map((key) => [key, budgets[key]]),
      ),
      id: q.id,
      enabled: q.enabled,
      next_run_at: q.next_run_at,
    })),
    candidates: totalCount.count ?? 0,
    verified: verifiedCount.count ?? 0,
    active: activeCount.count ?? 0,
    failed: failedCount.count ?? 0,
    reports: reportCount.count ?? 0,
    organization: { id: org, name: organization.name },
  };
}
