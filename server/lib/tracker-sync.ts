// Sync with the KNB tracker's Inquiries (the tracker's docs/SCOUT_SYNC.md).
// The worker calls the tracker; the tracker never calls Scout. Every pass:
//   1. free-audit requests waiting in the tracker become requested audits here;
//   2. finished (or failed) ones are posted back with the PDF and a summary;
//   3. leads you logged as Replied move to the tracker with their audit;
//   4. won/lost from the tracker comes back for search learning;
//   5. free audits you sent from the tracker are marked sent here.
// A post that fails is simply tried again on the next pass.
import { createHmac } from "node:crypto";
import { db, checked, insert, now } from "./db.js";
import { AuditRequestError, queueRequestedAudit } from "./audit-request.js";
import { publishSavedReport } from "./stored-report.js";
import { reportVersion } from "../modules/report.js";
import {
  comparableRuns,
  reportIssues,
} from "../../shared/audit-presentation.js";
import { explainFinding } from "../../shared/finding-explanation.js";
import type { Finding, PsiSample } from "../../shared/types.js";

export const trackerConfigured = () =>
  !!process.env.TRACKER_URL?.trim() && !!process.env.SCOUT_SYNC_SECRET?.trim();
export const trackerFreeAuditsUrl = () =>
  process.env.TRACKER_URL
    ? `${process.env.TRACKER_URL.replace(/\/$/, "")}/?section=free-audits`
    : null;
export const trackerInboxUrl = () =>
  process.env.TRACKER_URL
    ? `${process.env.TRACKER_URL.replace(/\/$/, "")}/?section=inquiries`
    : null;

export function signTrackerBody(
  secret: string,
  timestamp: string,
  body: string,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.TRACKER_URL!.replace(/\/$/, "");
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${base}/api/scout/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-scout-timestamp": timestamp,
      "x-scout-signature": signTrackerBody(
        process.env.SCOUT_SYNC_SECRET!,
        timestamp,
        raw,
      ),
    },
    body: raw,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* An HTML error page from a proxy: reported below by status. */
  }
  if (!res.ok)
    throw new TrackerError(
      `Tracker ${path} answered ${res.status}: ${(data as { error?: string })?.error ?? "no details"}`,
      res.status,
    );
  return data as T;
}

class TrackerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
/** The inquiry was trashed (or never existed): nothing is waiting for it. */
const inquiryGone = (e: unknown) =>
  e instanceof TrackerError && e.status === 404;

/** The workspace the tracker belongs to: TRACKER_SYNC_ORG, or the only one. */
async function syncOrg() {
  if (process.env.TRACKER_SYNC_ORG) return process.env.TRACKER_SYNC_ORG;
  const orgs = await checked(db().from("organizations").select("id").limit(2));
  if (orgs.length !== 1)
    throw new Error(
      "Set TRACKER_SYNC_ORG to the workspace that syncs with the tracker.",
    );
  return orgs[0].id as string;
}

export type TrackerSummary = {
  audited_at: string | null;
  mobile: number | null;
  desktop: number | null;
  seo: number | null;
  accessibility: number | null;
  findings: string[];
};

/** A store's latest finished audit: its PDF and what the tracker card shows. */
async function latestAudit(org: string, storeId: string) {
  const audit = (
    await checked(
      db()
        .from("audit_runs")
        .select("id,completed_at")
        .eq("organization_id", org)
        .eq("store_id", storeId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1),
    )
  )[0];
  if (!audit) return null;
  const [report, metrics, findings] = await Promise.all([
    checked(
      db()
        .from("reports")
        .select("id,storage_path")
        .eq("organization_id", org)
        .eq("audit_id", audit.id)
        .maybeSingle(),
    ),
    checked(
      db()
        .from("audit_metrics")
        .select("*")
        .eq("organization_id", org)
        .eq("audit_id", audit.id),
    ),
    checked(
      db()
        .from("audit_findings")
        .select("*")
        .eq("organization_id", org)
        .eq("audit_id", audit.id),
    ),
  ]);
  if (!report) return null;
  // Older PDFs are rebuilt first, so the client gets your current details.
  const path = report.storage_path.endsWith(`/report-${reportVersion}.pdf`)
    ? report.storage_path
    : await publishSavedReport(org, report.id);
  const file = await db().storage.from("audit-artifacts").download(path);
  if (file.error || !file.data)
    throw new Error(`Couldn't read the audit PDF: ${file.error?.message}`);
  const pdf = Buffer.from(await file.data.arrayBuffer());
  return {
    pdf,
    summary: summarize(
      metrics as PsiSample[],
      findings as Finding[],
      audit.completed_at,
    ),
  };
}

export function summarize(
  samples: PsiSample[],
  findings: Finding[],
  auditedAt: string | null,
): TrackerSummary {
  const mobile = comparableRuns(samples, "mobile"),
    desktop = comparableRuns(samples, "desktop");
  const issues = reportIssues(findings, samples).filter(
    (i) => i.kind === "verified",
  );
  return {
    audited_at: auditedAt,
    mobile: mobile.score("performance"),
    desktop: desktop.score("performance"),
    seo: mobile.score("seo"),
    accessibility: mobile.score("accessibility"),
    findings: issues
      .map((i) => explainFinding(i, findings, samples).title)
      .slice(0, 8),
  };
}

/** Which settled outcome of a job this is: each attempt has its own. */
export function outcomeKey(job: {
  status: string;
  started_at: string | null;
  completed_at: string | null;
}) {
  return `${job.status}@${job.completed_at ?? job.started_at ?? ""}`;
}

const lostReason: Record<string, string> = {
  budget: "No budget",
  timing: "Bad timing",
  elsewhere: "Chose someone else",
  no_reply: "No response",
  not_a_fit: "Not a fit",
  other: "Other",
};

type Step = "audits" | "results" | "leads" | "outcomes" | "sent";
/** One pass (or some steps of one). Returns what it did, for the worker log. */
export async function syncTracker(
  only: Step[] = ["audits", "results", "leads", "outcomes", "sent"],
) {
  if (!trackerConfigured()) return null;
  const org = await syncOrg();
  const run = (step: Step) => only.includes(step);
  const done = {
    queued: 0,
    posted: 0,
    failed: 0,
    leads: 0,
    outcomes: 0,
    sent: 0,
  };

  // 1. Free-audit requests waiting in the tracker.
  const { audits } = run("audits")
    ? await post<{ audits: { inquiry_id: string; website: string }[] }>(
        "pending",
        {},
      )
    : { audits: [] };
  for (const a of audits) {
    try {
      await queueRequestedAudit(org, a.website, {
        tracker_inquiry_id: a.inquiry_id,
      });
      await post("audit-status", {
        inquiry_id: a.inquiry_id,
        status: "running",
      });
      done.queued++;
    } catch (e) {
      if (!(e instanceof AuditRequestError)) throw e;
      await post("audit-status", {
        inquiry_id: a.inquiry_id,
        status: "failed",
        error: e.message,
      });
      done.failed++;
    }
  }

  // 2. Requested audits that finished or gave up, not yet posted back. A job
  // stopped for your attention (e.g. the site answered 404) counts as failed.
  // tracker_posted remembers which outcome was posted, so a job retried in
  // Scout, or run again from the tracker, is posted again when it settles.
  const candidates = !run("results")
    ? []
    : await checked(
        db()
          .from("automation_jobs")
          .select("id,status,error,wait_reason,started_at,completed_at,payload")
          .eq("organization_id", org)
          .eq("type", "audit")
          .not("payload->>tracker_inquiry_id", "is", null)
          .or(
            "status.in.(completed,failed,cancelled),and(status.eq.blocked,wait_reason.eq.attention)",
          )
          .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString())
          .order("created_at", { ascending: false })
          .limit(200),
      );
  const finished = candidates
    .map((job) => ({ job, key: outcomeKey(job) }))
    .filter(({ job, key }) => {
      const posted = job.payload.tracker_posted;
      // Posted before outcome keys existed (a bare timestamp): leave it.
      if (typeof posted === "string" && !posted.includes("@")) return false;
      return posted !== key;
    })
    .slice(0, 10);
  for (const { job, key } of finished) {
    const inquiry = job.payload.tracker_inquiry_id as string;
    const storeId = job.payload.store_id as string;
    const audit =
      job.status === "completed" ? await latestAudit(org, storeId) : null;
    try {
      if (audit) {
        const [store, lead] = await Promise.all([
          checked(
            db()
              .from("discovered_stores")
              .select("domain")
              .eq("organization_id", org)
              .eq("id", storeId)
              .single(),
          ),
          checked(
            db()
              .from("leads")
              .select("id")
              .eq("organization_id", org)
              .eq("store_id", storeId)
              .maybeSingle(),
          ),
        ]);
        await post("audit-result", {
          inquiry_id: inquiry,
          scout_lead_id: lead?.id ?? null,
          domain: store.domain,
          pdf_base64: audit.pdf.toString("base64"),
          summary: audit.summary,
        });
        done.posted++;
      } else {
        await post("audit-status", {
          inquiry_id: inquiry,
          status: "failed",
          error:
            (job.error as string | null)?.slice(0, 280) ||
            (job.status === "cancelled"
              ? "The audit was cancelled in Scout."
              : "Scout finished without a report."),
        });
        done.failed++;
      }
    } catch (e) {
      if (!inquiryGone(e)) throw e;
    }
    await checked(
      db()
        .from("automation_jobs")
        .update({ payload: { ...job.payload, tracker_posted: key } })
        .eq("id", job.id),
    );
  }

  // 3. Leads you logged as Replied, not yet in the tracker.
  const [replied, sent] = !run("leads")
    ? [[], []]
    : await Promise.all([
        checked(
          db()
            .from("lead_activities")
            .select("lead_id,details")
            .eq("organization_id", org)
            .eq("action", "contact_logged")
            .eq("details->>kind", "replied")
            .limit(500),
        ),
        checked(
          db()
            .from("lead_activities")
            .select("lead_id")
            .eq("organization_id", org)
            .eq("action", "sent_to_tracker")
            .limit(5000),
        ),
      ]);
  const already = new Set(sent.map((s) => s.lead_id));
  for (const leadId of [...new Set(replied.map((r) => r.lead_id))]
    .filter((id) => !already.has(id))
    .slice(0, 5)) {
    const lead = await checked(
      db()
        .from("leads")
        .select(
          "id,store_id,store:discovered_stores(domain,name,display_name,preferred_email)",
        )
        .eq("organization_id", org)
        .eq("id", leadId)
        .single(),
    );
    const store = lead.store as unknown as {
      domain: string;
      name: string;
      display_name: string | null;
      preferred_email: string | null;
    };
    const mail = await checked(
      db()
        .from("contacts")
        .select("route")
        .eq("organization_id", org)
        .eq("store_id", lead.store_id)
        .like("route", "mailto:%")
        .order("verified_at", { ascending: false })
        .limit(1),
    );
    const email = store.preferred_email ?? mail[0]?.route.slice(7) ?? null;
    if (!email) continue; // Nothing to reach them by; it stays in Scout.
    const audit = await latestAudit(org, lead.store_id);
    const { inquiry_id } = await post<{ inquiry_id: string }>("lead", {
      scout_lead_id: lead.id,
      email,
      name: store.display_name || store.name,
      domain: store.domain,
      ...(audit
        ? { pdf_base64: audit.pdf.toString("base64"), summary: audit.summary }
        : {}),
    });
    await insert("lead_activities", {
      organization_id: org,
      lead_id: lead.id,
      action: "sent_to_tracker",
      details: { inquiry_id },
    });
    done.leads++;
  }

  // 4. Won and lost, decided in the tracker.
  type Outcome = {
    scout_lead_id: string;
    status: "won" | "lost";
    lost_reason: string | null;
  };
  const { outcomes } = run("outcomes")
    ? await post<{ outcomes: Outcome[] }>("outcomes", {})
    : { outcomes: [] as Outcome[] };
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const ids = outcomes
    .map((o) => o.scout_lead_id)
    .filter((id) => uuid.test(id));
  const current = ids.length
    ? await checked(
        db()
          .from("leads")
          .select("id,outcome,outcome_reason")
          .eq("organization_id", org)
          .in("id", ids),
      )
    : [];
  for (const o of outcomes) {
    const lead = current.find((l) => l.id === o.scout_lead_id);
    if (!lead) continue;
    const reason =
      o.status === "lost" ? (lostReason[o.lost_reason ?? ""] ?? "Other") : null;
    if (lead.outcome === o.status && lead.outcome_reason === reason) continue;
    await checked(
      db()
        .from("leads")
        .update({
          outcome: o.status,
          outcome_reason: reason,
          outcome_at: now(),
          updated_at: now(),
        })
        .eq("organization_id", org)
        .eq("id", lead.id),
    );
    done.outcomes++;
  }

  // 5. Free audits whose PDF went to the client from the tracker.
  const waiting = !run("sent")
    ? []
    : await checked(
        db()
          .from("automation_jobs")
          .select("id,payload")
          .eq("organization_id", org)
          .eq("type", "audit")
          .eq("status", "completed")
          .not("payload->>tracker_inquiry_id", "is", null)
          .not("payload->>tracker_posted", "is", null)
          .is("payload->>tracker_sent_at", null)
          .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString())
          .limit(200),
      );
  if (waiting.length) {
    let sent: { inquiry_id: string; sent_at: string }[] = [];
    try {
      ({ sent } = await post<{ sent: typeof sent }>("audits-sent", {
        inquiry_ids: waiting.map((j) => j.payload.tracker_inquiry_id),
      }));
    } catch (e) {
      // A tracker deployed before this step: nothing to learn yet.
      if (!inquiryGone(e)) throw e;
    }
    for (const s of sent) {
      const job = waiting.find(
        (j) => j.payload.tracker_inquiry_id === s.inquiry_id,
      );
      if (!job) continue;
      await checked(
        db()
          .from("automation_jobs")
          .update({ payload: { ...job.payload, tracker_sent_at: s.sent_at } })
          .eq("id", job.id),
      );
      done.sent++;
    }
  }
  return done;
}
