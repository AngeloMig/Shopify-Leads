import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import path from "node:path";
import { existsSync } from "node:fs";
import { db, checked, configured, insert, now, userClient } from "./lib/db.js";
import {
  discoverySourceChanged,
  settingsSchema,
  uuid,
} from "./lib/validation.js";
import { enqueue } from "./pipeline.js";
import { leadScore } from "../shared/lead-score.js";
import {
  shortBusinessName,
  rankedEmails,
} from "../shared/lead-intelligence.js";
import { registerWorkspaceRoutes } from "./workspace-routes.js";
import { registerJobActivityRoutes } from "./job-activity-routes.js";
import { createReport, reportVersion } from "./modules/report.js";
import { publishSavedReport } from "./lib/stored-report.js";
import { lostReasons } from "../shared/types.js";
import type { Lead, DiscoverySettings, Finding } from "../shared/types.js";
const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "https:"],
        "connect-src": [
          "'self'",
          ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
        ],
      },
    },
  }),
);
app.use(express.json({ limit: "100kb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use("/api", (req, res, next) => {
  const origin = req.get("origin");
  if (
    origin &&
    origin !== process.env.APP_ORIGIN &&
    origin !== `${req.protocol}://${req.get("host")}`
  )
    return res.status(403).json({ error: "Origin not allowed" });
  next();
});
app.get("/api/status", (_req, res) =>
  res.json({
    configured: configured(),
    integrations: {
      storeleads: !!process.env.STORE_LEADS_API_KEY,
      brave: !!process.env.BRAVE_SEARCH_API_KEY,
      tavily: !!process.env.TAVILY_API_KEY?.trim(),
      pagespeed: !!process.env.PAGESPEED_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
    },
    demo_enabled: process.env.VITE_ENABLE_DEMO !== "false",
  }),
);
// Synthetic export contains no live findings and does not access the database.
app.post("/api/demo/report", async (req, res) => {
  const sample = z
    .object({
      name: z.string().max(100).optional(),
      domain: z
        .string()
        .regex(/^[a-z0-9.-]+\.example$/)
        .optional(),
    })
    .parse(req.body);
  if (process.env.VITE_ENABLE_DEMO === "false") return res.sendStatus(404);
  const pdf = await createReport({
    name: `${sample.name ?? "Northline Living"} (fictional)`,
    domain: sample.domain ?? "northline.example",
    date: now(),
    findings: [],
    samples: [],
    recommendations: [],
    activity: null,
    priority: 0,
    modernization: null,
    technologies: [],
    history: "No live historical research was performed.",
    demo: true,
  });
  res
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="scout-synthetic-demo.pdf"',
    })
    .send(pdf);
});
app.use("/api", async (req, res, next) => {
  try {
    if (!configured())
      return res.status(503).json({
        error: "Supabase is not configured. See Settings and .env.example.",
      });
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (!token) return res.status(401).json({ error: "Sign in required" });
    const { data, error } = await db().auth.getUser(token);
    if (error || !data.user)
      return res.status(401).json({ error: "Invalid or expired session" });
    res.locals.user = data.user;
    next();
  } catch (e) {
    next(e);
  }
});
app.post("/api/workspace", async (req, res, next) => {
  try {
    const name = z.string().trim().min(1).max(100).parse(req.body.name);
    const client = userClient(req.headers.authorization!);
    const id = await checked(
      client.rpc("create_workspace", { workspace_name: name }),
    );
    res.json({ id });
  } catch (e) {
    next(e);
  }
});
app.use("/api", async (_req, res, next) => {
  try {
    const members = await checked(
      db()
        .from("organization_members")
        .select("organization_id,role")
        .eq("user_id", res.locals.user.id)
        .order("organization_id")
        .limit(1),
    );
    if (!members.length)
      return res.status(409).json({
        error: "Create a workspace to get started.",
        code: "NO_WORKSPACE",
      });
    res.locals.org = members[0].organization_id;
    res.locals.role = members[0].role;
    next();
  } catch (e) {
    next(e);
  }
});
const admin = (res: express.Response) => {
  if (!["owner", "admin"].includes(res.locals.role)) {
    const error = new Error("Workspace administrator required");
    Object.assign(error, { status: 403 });
    throw error;
  }
};
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
async function snapshot(org: string, ids?: string[]) {
  let leadQuery = db()
    .from("leads")
    .select("*")
    .eq("organization_id", org)
    .order("updated_at", { ascending: false });
  if (ids)
    leadQuery = leadQuery.in(
      "id",
      ids.length ? ids : ["00000000-0000-0000-0000-000000000000"],
    );
  const leadRows = await checked(leadQuery.limit(ids ? 100 : 500));
  const storeIds = leadRows.length
    ? leadRows.map((l) => l.store_id)
    : ["00000000-0000-0000-0000-000000000000"];
  const auditIds = leadRows.length
    ? leadRows.map((l) => l.audit_id)
    : ["00000000-0000-0000-0000-000000000000"];
  const stores = await checked(
    db()
      .from("discovered_stores")
      .select("*")
      .eq("organization_id", org)
      .in("id", storeIds),
  );
  const domains = stores.length
    ? stores.map((s) => s.domain)
    : ["no-loaded-domain.invalid"];
  const [
    scores,
    findings,
    recs,
    reports,
    reviews,
    suppression,
    jobs,
    queries,
    organization,
    totalCount,
    verifiedCount,
    activeCount,
    failedCount,
    reportCount,
    contacts,
  ] = await Promise.all([
    checked(
      db()
        .from("lead_scores")
        .select("*")
        .eq("organization_id", org)
        .in("audit_id", auditIds)
        .order("created_at", { ascending: false })
        .limit(5000),
    ),
    readPages((start, end) =>
      db()
        .from("audit_findings")
        .select("*")
        .eq("organization_id", org)
        .in("audit_id", auditIds)
        .order("id")
        .range(start, end),
    ),
    readPages((start, end) =>
      db()
        .from("ai_recommendations")
        .select("*")
        .eq("organization_id", org)
        .in("audit_id", auditIds)
        .order("id")
        .range(start, end),
    ),
    checked(
      db()
        .from("reports")
        .select("*")
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
    checked(
      db()
        .from("automation_jobs")
        .select("*")
        .eq("organization_id", org)
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    checked(
      db().from("discovery_queries").select("*").eq("organization_id", org),
    ),
    checked(db().from("organizations").select("*").eq("id", org).single()),
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
  ]);
  for (const result of [
    totalCount,
    verifiedCount,
    activeCount,
    failedCount,
    reportCount,
  ])
    if (result.error) throw new Error(result.error.message);
  const leads: Lead[] = leadRows
    .map((l): Lead | null => {
      const s = stores.find((s) => s.id === l.store_id);
      if (!s) return null;
      const sc = scores.find((s) => s.audit_id === l.audit_id);
      const permission = reviews.find((r) => r.store_id === s.id);
      const blocked = suppression.some((x) => x.domain === s.domain);
      const approved =
        permission?.status === "approved" &&
        new Date(permission.expires_at) > new Date();
      const leadFindings = findings.filter(
        (f) => f.audit_id === l.audit_id,
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
      const catalog = sc?.breakdown?.catalog ?? null;
      const fit = sc?.breakdown?.fit ?? null;
      const timing = sc?.breakdown?.timing ?? [];
      const priority = leadScore({
        findings: leadFindings,
        performance: sc?.performance ?? null,
        activity: s.activity ?? null,
        emails,
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
        recommendations: recs
          .filter((r) => r.audit_id === l.audit_id)
          .map((r) => r.recommendation),
        notes: l.notes,
        owner: l.owner,
        contact_url: s.contact_url,
        emails,
        catalog,
        fit,
        timing_signals: timing,
        outcome: l.outcome ?? null,
        outcome_reason: l.outcome_reason ?? null,
        outcome_at: l.outcome_at ?? null,
        permission: approved
          ? "approved"
          : permission?.status === "rejected"
            ? "rejected"
            : "unknown",
        suppressed: blocked,
      };
    })
    .filter((l): l is Lead => l !== null);
  const workspaceSettings = await checked(
    db()
      .from("app_settings")
      .select("config")
      .eq("organization_id", org)
      .maybeSingle(),
  );
  const budgets = workspaceSettings?.config ?? {};
  const jobStoreIds = [
    ...new Set(
      jobs
        .map((j) => j.payload?.store_id)
        .filter(
          (id: unknown) =>
            typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id as string),
        ),
    ),
  ];
  const jobStores = jobStoreIds.length
    ? await checked(
        db()
          .from("discovered_stores")
          .select("id,name,display_name,domain")
          .eq("organization_id", org)
          .in("id", jobStoreIds),
      )
    : [];
  return {
    leads,
    jobs: jobs.map((j) => {
      const store = jobStores.find((s) => s.id === j.payload?.store_id);
      const query = queries.find((q) => q.id === j.payload?.query_id);
      return {
        ...j,
        payload: {
          ...j.payload,
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
registerJobActivityRoutes(app);
registerWorkspaceRoutes(
  app,
  async (org, ids) => (await snapshot(org, ids)).leads,
  admin,
);
app.get("/api/snapshot", async (_req, res, next) => {
  try {
    res.json(await snapshot(res.locals.org));
  } catch (e) {
    next(e);
  }
});
app.post("/api/settings", async (req, res, next) => {
  try {
    admin(res);
    const config = settingsSchema.parse(req.body);
    const id = req.body.id ? uuid.parse(req.body.id) : null;
    const previous = id
      ? await checked(
          db()
            .from("discovery_queries")
            .select("config")
            .eq("id", id)
            .eq("organization_id", res.locals.org)
            .single(),
        )
      : null;
    const row = {
      organization_id: res.locals.org,
      name: config.name,
      config,
      enabled: config.enabled,
      interval_hours: config.interval_hours,
      ...(!previous || discoverySourceChanged(previous.config, config)
        ? { source_cursor: null }
        : {}),
    };
    const data = id
      ? await checked(
          db()
            .from("discovery_queries")
            .update(row)
            .eq("id", id)
            .eq("organization_id", res.locals.org)
            .select()
            .single(),
        )
      : await insert("discovery_queries", row);
    await checked(
      db()
        .from("app_settings")
        .upsert(
          {
            organization_id: res.locals.org,
            config: {
              retention_days: config.retention_days,
              daily_api_budget: config.daily_api_budget,
              discovery_daily_budget:
                config.discovery_daily_budget ?? config.daily_api_budget,
              audit_daily_budget:
                config.audit_daily_budget ?? config.daily_api_budget,
              max_audit_backlog: config.max_audit_backlog ?? 5,
              scheduled_runs_per_day: config.scheduled_runs_per_day ?? 1,
            },
          },
          { onConflict: "organization_id" },
        ),
    );
    res.json(data);
  } catch (e) {
    next(e);
  }
});
app.post("/api/discovery", async (req, res, next) => {
  try {
    admin(res);
    const id = uuid.parse(req.body.query_id);
    const q = await checked(
      db()
        .from("discovery_queries")
        .select("*")
        .eq("id", id)
        .eq("organization_id", res.locals.org)
        .single(),
    );
    const job = await enqueue(
      res.locals.org,
      "discovery",
      `discovery:${q.id}`,
      { query_id: q.id },
    );
    res.status(job ? 202 : 200).json({ job, already_queued: !job });
  } catch (e) {
    next(e);
  }
});
app.post("/api/discovery/stop", async (_req, res, next) => {
  try {
    admin(res);
    const cancelled = await checked(
      db().rpc("stop_discovery", { org: res.locals.org }),
    );
    res.json({ cancelled });
  } catch (e) {
    next(e);
  }
});
app.post("/api/jobs/:id/cancel", async (req, res, next) => {
  try {
    admin(res);
    const cancelled = await checked(
      db().rpc("cancel_job", {
        org: res.locals.org,
        job: uuid.parse(req.params.id),
      }),
    );
    res.json({ cancelled });
  } catch (e) {
    next(e);
  }
});
app.post("/api/leads/:id/audit", async (req, res, next) => {
  try {
    const lead = await checked(
      db()
        .from("leads")
        .select("*")
        .eq("id", uuid.parse(req.params.id))
        .eq("organization_id", res.locals.org)
        .single(),
    );
    const previousJobs = await checked(
      db()
        .from("automation_jobs")
        .select("payload")
        .eq("organization_id", res.locals.org)
        .eq("type", "audit")
        .contains("payload", { store_id: lead.store_id })
        .order("created_at", { ascending: false })
        .limit(1),
    );
    const q = await checked(
      db()
        .from("discovery_queries")
        .select("config")
        .eq("organization_id", res.locals.org)
        .order("created_at")
        .limit(1),
    );
    const auditConfig = previousJobs[0]?.payload?.config ?? q[0]?.config;
    if (!auditConfig)
      return res
        .status(400)
        .json({ error: "Save discovery settings before requesting an audit." });
    const job = await enqueue(
      res.locals.org,
      "audit",
      `audit:${lead.store_id}`,
      { store_id: lead.store_id, config: auditConfig },
    );
    res.status(202).json({ job, already_queued: !job });
  } catch (e) {
    next(e);
  }
});
app.patch("/api/leads/:id", async (req, res, next) => {
  try {
    const patch = z
      .object({
        stage: z.enum(["new", "reviewing", "qualified", "hold"]).optional(),
        notes: z.string().max(10000).optional(),
        owner: z.string().max(100).optional(),
        outcome: z.enum(["won", "lost"]).nullable().optional(),
        outcome_reason: z.enum(lostReasons).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    const data = await checked(
      db()
        .from("leads")
        .update({
          ...patch,
          ...(patch.outcome !== undefined
            ? {
                outcome_at: patch.outcome ? now() : null,
                // Only a lost lead has a reason; "not a fit" feeds search learning.
                outcome_reason:
                  patch.outcome === "lost"
                    ? (patch.outcome_reason ?? null)
                    : null,
              }
            : {}),
          updated_at: now(),
        })
        .eq("id", uuid.parse(req.params.id))
        .eq("organization_id", res.locals.org)
        .select()
        .single(),
    );
    await insert("lead_activities", {
      organization_id: res.locals.org,
      lead_id: data.id,
      actor: res.locals.user.id,
      action: patch.outcome !== undefined ? "outcome_recorded" : "lead_updated",
      details: patch,
    });
    res.json(data);
  } catch (e) {
    if (
      e instanceof Error &&
      /outcome.*column|column.*outcome/i.test(e.message)
    )
      return res.status(503).json({
        error:
          "Won/lost tracking needs database migration 010_lead_outcomes.sql.",
      });
    next(e);
  }
});
app.post("/api/leads/:id/permission", async (req, res, next) => {
  try {
    admin(res);
    const data = z
      .object({
        status: z.enum(["approved", "rejected"]),
        rationale: z.string().trim().min(20).max(2000),
      })
      .parse(req.body);
    const lead = await checked(
      db()
        .from("leads")
        .select("store_id")
        .eq("id", uuid.parse(req.params.id))
        .eq("organization_id", res.locals.org)
        .single(),
    );
    const store = await checked(
      db()
        .from("discovered_stores")
        .select("*")
        .eq("id", lead.store_id)
        .eq("organization_id", res.locals.org)
        .single(),
    );
    if (!store.country || !store.country_evidence || !store.contact_url)
      return res.status(400).json({
        error:
          "Verified country evidence and a public professional contact route are required.",
      });
    const suppressed = await checked(
      db()
        .from("suppression_list")
        .select("id")
        .eq("organization_id", res.locals.org)
        .eq("domain", store.domain),
    );
    if (suppressed.length && data.status === "approved")
      return res.status(400).json({ error: "This domain is suppressed." });
    await insert("contact_permission_reviews", {
      ...data,
      organization_id: res.locals.org,
      store_id: store.id,
      country: store.country,
      reviewed_by: res.locals.user.id,
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    });
    await insert("lead_activities", {
      organization_id: res.locals.org,
      lead_id: req.params.id,
      actor: res.locals.user.id,
      action: `permission_${data.status}`,
      details: { rationale: data.rationale },
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
app.post("/api/leads/:id/suppress", async (req, res, next) => {
  try {
    const reason = z.string().trim().min(3).max(1000).parse(req.body.reason);
    const lead = await checked(
      db()
        .from("leads")
        .select("store_id")
        .eq("id", uuid.parse(req.params.id))
        .eq("organization_id", res.locals.org)
        .single(),
    );
    const store = await checked(
      db()
        .from("discovered_stores")
        .select("domain")
        .eq("id", lead.store_id)
        .eq("organization_id", res.locals.org)
        .single(),
    );
    await checked(
      db()
        .from("suppression_list")
        .upsert(
          { organization_id: res.locals.org, domain: store.domain, reason },
          { onConflict: "organization_id,domain" },
        ),
    );
    await checked(
      db()
        .from("leads")
        .update({ stage: "suppressed" })
        .eq("id", req.params.id)
        .eq("organization_id", res.locals.org),
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
app.get("/api/leads/:id/history", async (req, res, next) => {
  try {
    const lead = await checked(
      db()
        .from("leads")
        .select("store_id")
        .eq("id", uuid.parse(req.params.id))
        .eq("organization_id", res.locals.org)
        .single(),
    );
    const audits = await checked(
      db()
        .from("audit_runs")
        .select("*")
        .eq("store_id", lead.store_id)
        .eq("organization_id", res.locals.org)
        .order("started_at", { ascending: false })
        .limit(25),
    );
    res.json(audits);
  } catch (e) {
    next(e);
  }
});
app.get("/api/reports/:id/download", async (req, res, next) => {
  try {
    const r = await checked(
      db()
        .from("reports")
        .select("id,store_id,storage_path")
        .eq("id", uuid.parse(req.params.id))
        .eq("organization_id", res.locals.org)
        .single(),
    );
    const storagePath = r.storage_path.endsWith(`/report-${reportVersion}.pdf`)
      ? r.storage_path
      : await publishSavedReport(res.locals.org, r.id);
    const store = await checked(
      db()
        .from("discovered_stores")
        .select("domain")
        .eq("id", r.store_id)
        .eq("organization_id", res.locals.org)
        .single(),
    );
    const filename = `${store.domain.replace(/[^a-z0-9.-]/gi, "_")}-audit.pdf`;
    const data = await checked(
      db()
        .storage.from("audit-artifacts")
        .createSignedUrl(storagePath, 60, { download: filename }),
    );
    res.json({ url: data.signedUrl });
  } catch (e) {
    next(e);
  }
});
app.get("/api/leads/:id/artifacts", async (req, res, next) => {
  try {
    const lead = await checked(
      db()
        .from("leads")
        .select("audit_id")
        .eq("id", uuid.parse(req.params.id))
        .eq("organization_id", res.locals.org)
        .single(),
    );
    const [screenshots, history, metrics, activities] = await Promise.all([
      checked(
        db()
          .from("audit_screenshots")
          .select("*")
          .eq("organization_id", res.locals.org)
          .eq("audit_id", lead.audit_id),
      ),
      checked(
        db()
          .from("historical_snapshots")
          .select("*")
          .eq("organization_id", res.locals.org)
          .eq("audit_id", lead.audit_id),
      ),
      checked(
        db()
          .from("audit_metrics")
          .select("*")
          .eq("organization_id", res.locals.org)
          .eq("audit_id", lead.audit_id),
      ),
      checked(
        db()
          .from("lead_activities")
          .select("*")
          .eq("organization_id", res.locals.org)
          .eq("lead_id", req.params.id)
          .order("created_at", { ascending: false })
          .limit(25),
      ),
    ]);
    const images = await Promise.all(
      screenshots.map(async (s) => ({
        ...s,
        url: (
          await checked(
            db()
              .storage.from("audit-artifacts")
              .createSignedUrl(s.storage_path, 60),
          )
        ).signedUrl,
      })),
    );
    res.json({ screenshots: images, history, metrics, activities });
  } catch (e) {
    next(e);
  }
});
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found" });
});
const dist = path.resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(dist, "index.html")),
  );
}
app.use(
  (
    error: Error,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status =
      error instanceof z.ZodError
        ? 400
        : ((error as Error & { status?: number }).status ?? 500);
    console.error(`${req.method} ${req.path}: ${error.message}`);
    res.status(status).json({
      error:
        error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          : status < 500
            ? error.message
            : "The operation failed. Check the API logs and integration configuration.",
    });
  },
);
const port = Number(process.env.PORT) || 3001;
app.listen(port, () =>
  console.info(
    `Scout API listening on ${port}. Live database: ${configured() ? "configured" : "not configured"}`,
  ),
);
