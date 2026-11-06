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
import { loadLeads, snapshot } from "./workspace-snapshot.js";
import { registerLocalBusinessRoutes } from "./local-business-routes.js";
import { registerWorkspaceRoutes } from "./workspace-routes.js";
import { deliverAlerts } from "./lib/alerts.js";
import { registerJobActivityRoutes } from "./job-activity-routes.js";
import { createReport, reportVersion } from "./modules/report.js";
import { publishSavedReport } from "./lib/stored-report.js";
import { lostReasons } from "../shared/types.js";
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
registerJobActivityRoutes(app);
registerWorkspaceRoutes(app, loadLeads, admin);
registerLocalBusinessRoutes(app, admin);
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
// A stopped worker can't report itself, so the API watches for that one alert.
if (configured() && process.env.ALERT_WEBHOOK_URL)
  setInterval(() => {
    void deliverAlerts("api", (a) => a.key === "worker_offline", {
      digest: false,
    }).catch((e) =>
      console.error(
        "Alert delivery failed:",
        e instanceof Error ? e.message : "unknown",
      ),
    );
  }, 300000);
const port = Number(process.env.PORT) || 3001;
app.listen(port, () =>
  console.info(
    `Scout API listening on ${port}. Live database: ${configured() ? "configured" : "not configured"}`,
  ),
);
