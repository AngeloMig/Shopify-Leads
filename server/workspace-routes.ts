import type { Express, Response, Request, NextFunction } from "express";
import { z } from "zod";
import { db, checked, insert, now } from "./lib/db.js";
import { uuid } from "./lib/validation.js";
import { normalizeDomain, validateTarget } from "./lib/network.js";
import { discoveryHistory } from "./lib/discovery-history.js";
import { enqueue } from "./pipeline.js";
import { workspaceAlerts } from "./lib/alerts.js";
import type { LeadEvidence } from "./workspace-snapshot.js";
import type { Lead } from "../shared/types.js";
import { industries } from "../shared/types.js";
import { queryPerformance } from "../shared/discovery-search.js";
import { readSender } from "../shared/sender.js";
import {
  contactKinds,
  readContactLog,
  type ContactRow,
} from "../shared/contact-log.js";

const route =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
export function registerWorkspaceRoutes(
  app: Express,
  load: (org: string, ids: string[], evidence: LeadEvidence) => Promise<Lead[]>,
  admin: (res: Response) => void,
) {
  app.get(
    "/api/leads",
    route(async (req, res) => {
      const input = z
        .object({
          q: z.string().max(150).default(""),
          view: z
            .enum([
              "all",
              "new",
              "strong",
              "missing_contact",
              "review",
              "won",
              "lost",
              "due",
            ])
            .default("all"),
          /** The user's own date, for follow-ups due today. */
          today: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          country: z.enum(["all", "US", "GB", "CA", "AU"]).default("all"),
          stage: z
            .enum([
              "all",
              "new",
              "reviewing",
              "qualified",
              "hold",
              "suppressed",
            ])
            .default("all"),
          sort: z
            .enum(["opportunity", "recent", "name"])
            .default("opportunity"),
          page: z.coerce.number().int().min(0).max(100000).default(0),
          size: z.coerce.number().int().min(5).max(50).default(10),
        })
        .parse(req.query);
      // Follow-ups due by today, read from the contact log.
      const due =
        input.view === "due"
          ? [
              ...readContactLog(
                (await checked(
                  db()
                    .from("lead_activities")
                    .select("lead_id,details,created_at")
                    .eq("organization_id", res.locals.org)
                    .eq("action", "contact_logged")
                    .order("created_at", { ascending: false })
                    .limit(5000),
                )) as ContactRow[],
              ),
            ]
              .filter(
                ([, c]) =>
                  !!c.follow_up_at &&
                  c.follow_up_at <= (input.today ?? now().slice(0, 10)),
              )
              .map(([id]) => id)
          : [];
      const search = (byScore: boolean) => {
        let query = db()
          .from("lead_search_index")
          .select("id", { count: "exact" })
          .eq("organization_id", res.locals.org);
        if (input.q.trim())
          query = query.ilike(
            "search_text",
            `%${input.q.trim().replace(/[\\%_]/g, "\\$&")}%`,
          );
        if (input.country !== "all") query = query.eq("country", input.country);
        if (input.stage !== "all") query = query.eq("stage", input.stage);
        if (input.view === "new") query = query.eq("stage", "new");
        if (input.view === "strong") query = query.eq("opportunity_rank", 2);
        if (input.view === "missing_contact")
          query = query.eq("has_email", false);
        if (input.view === "review")
          query = query.eq("permission", "unknown").gte("opportunity_rank", 0);
        if (input.view === "won" || input.view === "lost")
          query = query.eq("outcome", input.view);
        if (input.view === "due")
          query = query
            .in(
              "id",
              due.length ? due : ["00000000-0000-0000-0000-000000000000"],
            )
            .is("outcome", null);
        if (input.sort === "opportunity") {
          if (byScore)
            query = query.order("research_score", {
              ascending: false,
              nullsFirst: false,
            });
          query = query
            .order("opportunity_rank", { ascending: false })
            .order("performance", { ascending: true, nullsFirst: false });
        } else
          query = query.order(
            input.sort === "recent" ? "updated_at" : "business_name",
            { ascending: input.sort === "name" },
          );
        return query
          .order("id")
          .range(input.page * input.size, (input.page + 1) * input.size - 1);
      };
      let { data, error, count } = await search(true);
      // Until migration 010 adds the score column, keep the previous ranking.
      if (error?.message.includes("research_score"))
        ({ data, error, count } = await search(false));
      if (error) throw new Error(error.message);
      const ids = (data ?? []).map((x) => x.id);
      const leads = await load(res.locals.org, ids, "summary");
      res.json({
        leads: ids.map((id) => leads.find((l) => l.id === id)).filter(Boolean),
        total: count ?? 0,
        page: input.page,
        size: input.size,
      });
    }),
  );
  app.get(
    "/api/leads/:id",
    route(async (req, res) => {
      const leads = await load(
        res.locals.org,
        [uuid.parse(req.params.id)],
        "full",
      );
      if (!leads[0]) return res.status(404).json({ error: "Lead not found" });
      res.json(leads[0]);
    }),
  );
  app.patch(
    "/api/leads/:id/profile",
    route(async (req, res) => {
      const patch = z
        .object({
          display_name: z.string().trim().min(1).max(100).optional(),
          preferred_email: z.string().email().max(254).nullable().optional(),
          industry: z
            .string()
            .refine(
              (value) => [...industries, "Unknown"].includes(value),
              "Choose a supported industry",
            )
            .optional(),
        })
        .strict()
        .parse(req.body);
      const lead = await checked(
        db()
          .from("leads")
          .select("store_id")
          .eq("organization_id", res.locals.org)
          .eq("id", uuid.parse(req.params.id))
          .single(),
      );
      if (patch.preferred_email) {
        const contacts = await checked(
          db()
            .from("contacts")
            .select("route")
            .eq("organization_id", res.locals.org)
            .eq("store_id", lead.store_id),
        );
        if (
          !contacts.some(
            (c) =>
              c.route.toLowerCase() ===
              `mailto:${patch.preferred_email!.toLowerCase()}`,
          )
        )
          return res.status(400).json({
            error:
              "Choose an email already published in this lead’s contact evidence.",
          });
      }
      await checked(
        db()
          .from("discovered_stores")
          .update({
            ...patch,
            ...(patch.industry
              ? {
                  industry_confidence: "manual",
                  industry_manual: true,
                  industry_evidence: `Manually classified by a workspace researcher at ${now()}.`,
                }
              : {}),
          })
          .eq("organization_id", res.locals.org)
          .eq("id", lead.store_id),
      );
      await checked(
        db()
          .from("leads")
          .update({ updated_at: now() })
          .eq("organization_id", res.locals.org)
          .eq("id", req.params.id),
      );
      await insert("lead_activities", {
        organization_id: res.locals.org,
        lead_id: req.params.id,
        actor: res.locals.user.id,
        action: "profile_updated",
        details: patch,
      });
      res.json(
        (await load(res.locals.org, [String(req.params.id)], "full"))[0],
      );
    }),
  );
  app.post(
    "/api/leads/:id/contact",
    route(async (req, res) => {
      const id = uuid.parse(req.params.id);
      const input = z
        .object({
          kind: z.enum(contactKinds),
          follow_up_at: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
        })
        .strict()
        .parse(req.body);
      const lead = await checked(
        db()
          .from("leads")
          .update({ updated_at: now() })
          .eq("organization_id", res.locals.org)
          .eq("id", id)
          .select("id")
          .maybeSingle(),
      );
      if (!lead) return res.status(404).json({ error: "Lead not found" });
      await insert("lead_activities", {
        organization_id: res.locals.org,
        lead_id: id,
        actor: res.locals.user.id,
        action: "contact_logged",
        details: input,
      });
      const log = await checked(
        db()
          .from("lead_activities")
          .select("lead_id,details,created_at")
          .eq("organization_id", res.locals.org)
          .eq("action", "contact_logged")
          .eq("lead_id", id)
          .limit(500),
      );
      res.json(readContactLog(log as ContactRow[]).get(id) ?? null);
    }),
  );
  // Who outreach comes from, filled into the email and call scripts.
  const senderConfig = async (org: string) =>
    ((
      await checked(
        db()
          .from("app_settings")
          .select("config")
          .eq("organization_id", org)
          .maybeSingle(),
      )
    )?.config ?? {}) as Record<string, unknown>;
  app.get(
    "/api/sender",
    route(async (_req, res) => {
      res.json(readSender((await senderConfig(res.locals.org)).sender));
    }),
  );
  app.put(
    "/api/sender",
    route(async (req, res) => {
      admin(res);
      const text = (max: number) => z.string().trim().max(max).default("");
      const sender = z
        .object({
          name: text(120),
          company: text(160),
          address: text(300),
          portfolio_url: z
            .string()
            .trim()
            .max(300)
            .default("")
            .refine(
              (u) => !u || /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(u),
              "Use the full address, starting with https://",
            ),
          work: z
            .array(
              z
                .object({
                  title: z.string().trim().min(1).max(120),
                  url: z
                    .string()
                    .trim()
                    .max(300)
                    .regex(
                      /^https?:\/\/\S+\.\S+$/i,
                      "Use a full https:// link",
                    ),
                  industry: z.string().trim().max(60).default(""),
                })
                .strict(),
            )
            .max(8)
            .default([]),
        })
        .strict()
        .parse(req.body);
      const config = await senderConfig(res.locals.org);
      await checked(
        db()
          .from("app_settings")
          .upsert(
            { organization_id: res.locals.org, config: { ...config, sender } },
            { onConflict: "organization_id" },
          ),
      );
      res.json(sender);
    }),
  );
  app.get(
    "/api/alerts",
    route(async (_req, res) => {
      res.json(await workspaceAlerts(res.locals.org));
    }),
  );
  app.get(
    "/api/operations",
    route(async (_req, res) => {
      const org = res.locals.org;
      const [workers, usage, settings, queue, summary, blocks, schedules] =
        await Promise.all([
          checked(
            db()
              .from("worker_heartbeats")
              .select("*")
              .eq("organization_id", org)
              .order("last_seen", { ascending: false })
              .limit(5),
          ),
          checked(
            db()
              .from("api_usage_daily")
              .select("*")
              .eq("organization_id", org)
              .eq("day", now().slice(0, 10))
              .maybeSingle(),
          ),
          checked(
            db()
              .from("app_settings")
              .select("config")
              .eq("organization_id", org)
              .maybeSingle(),
          ),
          checked(db().rpc("automation_queue_reasons", { org })),
          checked(db().rpc("automation_summary", { org })),
          checked(
            db()
              .from("provider_blocks")
              .select("provider,reason,code,blocked_until")
              .eq("organization_id", org),
          ),
          checked(
            db()
              .from("discovery_queries")
              .select("id,name,enabled,next_run_at,interval_hours")
              .eq("organization_id", org),
          ),
        ]);
      res.json({
        workers,
        usage: usage ?? { units: 0, discovery_units: 0, audit_units: 0 },
        budgets: settings?.config ?? {},
        server_time: now(),
        queue,
        summary,
        blocks,
        schedules,
      });
    }),
  );
  app.post(
    "/api/jobs/:id/retry",
    route(async (req, res) => {
      admin(res);
      const job = await checked(
        db()
          .from("automation_jobs")
          .select("id,error_provider,error_code")
          .eq("organization_id", res.locals.org)
          .eq("id", uuid.parse(req.params.id))
          .in("status", ["failed", "blocked"])
          .maybeSingle(),
      );
      if (!job)
        return res.status(409).json({
          error: "Only failed or needs-attention jobs can be resumed.",
        });
      if (job.error_code === "search_limit")
        return res.status(409).json({
          error:
            "Start a new discovery run to receive a new per-run request allowance.",
        });
      if (job.error_provider) {
        const block = await checked(
          db()
            .from("provider_blocks")
            .select("provider")
            .eq("organization_id", res.locals.org)
            .eq("provider", job.error_provider)
            .or(`blocked_until.is.null,blocked_until.gt.${now()}`)
            .maybeSingle(),
        );
        if (block)
          return res
            .status(409)
            .json({ error: "Resolve and resume the paused provider first." });
      }
      const updated = await checked(
        db()
          .from("automation_jobs")
          .update({
            status: "queued",
            attempts: 0,
            available_at: now(),
            wait_reason: null,
            error: null,
            error_code: null,
            completed_at: null,
            worker_id: null,
            lease_until: null,
          })
          .eq("organization_id", res.locals.org)
          .eq("id", job.id)
          .in("status", ["failed", "blocked"])
          .select("id"),
      );
      if (!updated.length)
        return res
          .status(409)
          .json({ error: "This job has already changed. Refresh the queue." });
      res.json({ queued: true });
    }),
  );
  app.post(
    "/api/operations/providers/:provider/resume",
    route(async (req, res) => {
      admin(res);
      const provider = z
        .enum([
          "tavily",
          "brave",
          "storeleads",
          "pagespeed",
          "openai",
          "provider",
        ])
        .parse(req.params.provider);
      await checked(
        db()
          .from("provider_blocks")
          .delete()
          .eq("organization_id", res.locals.org)
          .eq("provider", provider),
      );
      await checked(
        db()
          .from("automation_jobs")
          .update({
            status: "queued",
            attempts: 0,
            available_at: now(),
            wait_reason: null,
            error: null,
            error_code: null,
            completed_at: null,
          })
          .eq("organization_id", res.locals.org)
          .eq("error_provider", provider)
          .eq("status", "blocked")
          .in("error_code", ["credentials", "provider_paused"]),
      );
      res.json({ resumed: true });
    }),
  );
  app.get(
    "/api/discovery/insights",
    route(async (req, res) => {
      const input = z.object({ campaign: uuid.optional() }).parse(req.query);
      const org = res.locals.org;
      let searchQuery = db()
        .from("discovery_search_outcomes")
        .select("*")
        .eq("organization_id", org)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (input.campaign)
        searchQuery = searchQuery.eq("query_id", input.campaign);
      let candidateQuery = db()
        .from("candidate_reviews")
        .select("id,domain,name,reason,status,created_at,source_url")
        .eq("organization_id", org)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(100);
      if (input.campaign)
        candidateQuery = candidateQuery.eq("query_id", input.campaign);
      const [searches, candidates, queries, pool] = await Promise.all([
        checked(searchQuery),
        checked(candidateQuery),
        checked(
          db()
            .from("discovery_queries")
            .select("id,name,config,enabled")
            .eq("organization_id", org)
            .order("created_at"),
        ),
        checked(
          db().rpc("discovery_pool_summary", {
            org,
            campaign: input.campaign ?? null,
          }),
        ),
      ]);
      res.json({
        queries,
        candidates,
        searches,
        pool,
        performance: queryPerformance(searches),
        window: 1000,
      });
    }),
  );
  app.post(
    "/api/candidates/:id/review",
    route(async (req, res) => {
      admin(res);
      const input = z
        .discriminatedUnion("status", [
          z.object({ status: z.literal("dismissed") }),
          z.object({
            status: z.literal("verified"),
            country: z.enum(["US", "GB", "CA", "AU"]),
            source_url: z.string().url().max(2000),
            evidence: z.string().trim().min(20).max(1500),
          }),
        ])
        .parse(req.body);
      const c = await checked(
        db()
          .from("candidate_reviews")
          .select("*")
          .eq("organization_id", res.locals.org)
          .eq("id", uuid.parse(req.params.id))
          .single(),
      );
      if (c.status !== "pending")
        return res
          .status(409)
          .json({ error: "This candidate has already been reviewed." });
      if (input.status === "verified") {
        await validateTarget(input.source_url);
        const q = await checked(
          db()
            .from("discovery_queries")
            .select("config")
            .eq("organization_id", res.locals.org)
            .eq("id", c.query_id)
            .single(),
        );
        if (!q.config.countries.includes(input.country))
          return res
            .status(400)
            .json({ error: "Choose a country included in this campaign." });
        const suppressed = await checked(
          db()
            .from("suppression_list")
            .select("id")
            .eq("organization_id", res.locals.org)
            .eq("domain", c.domain),
        );
        if (suppressed.length)
          return res.status(409).json({ error: "This domain is suppressed." });
        if (!(await discoveryHistory(res.locals.org, c.domain))?.seen) {
          const store = await checked(
            db()
              .from("discovered_stores")
              .upsert(
                {
                  organization_id: res.locals.org,
                  domain: c.domain,
                  name: c.name,
                  source_url: c.source_url,
                  source_provider: "manual-country-review",
                  country: input.country,
                  country_evidence: `Researcher verified ${input.source_url}: ${input.evidence}`,
                  shopify_verified: true,
                  activity: c.metadata.activity ?? null,
                },
                { onConflict: "organization_id,domain" },
              )
              .select()
              .single(),
          );
          await enqueue(res.locals.org, "audit", `audit:${store.id}`, {
            store_id: store.id,
            config: q.config,
          });
        }
      }
      await checked(
        db()
          .from("candidate_reviews")
          .update({
            status: input.status,
            reviewed_at: now(),
            ...(input.status === "verified"
              ? { metadata: { ...c.metadata, review: input } }
              : {}),
          })
          .eq("organization_id", res.locals.org)
          .eq("id", c.id),
      );
      res.json({ ok: true });
    }),
  );
  // A free-audit request: one website someone asked us to review. It runs the
  // same audit and PDF as discovered leads, without the prospecting checks.
  app.post(
    "/api/audits/request",
    route(async (req, res) => {
      const input = z
        .object({ url: z.string().trim().min(1).max(2000) })
        .parse(req.body);
      let domain: string;
      try {
        domain = normalizeDomain(input.url);
        await validateTarget(`https://${domain}`);
      } catch {
        return res
          .status(400)
          .json({ error: "Enter a public website address, like store.com." });
      }
      const suppressed = await checked(
        db()
          .from("suppression_list")
          .select("id")
          .eq("organization_id", res.locals.org)
          .eq("domain", domain),
      );
      if (suppressed.length)
        return res
          .status(409)
          .json({ error: "This website opted out. It can't be audited." });
      const q = await checked(
        db()
          .from("discovery_queries")
          .select("config")
          .eq("organization_id", res.locals.org)
          .order("created_at")
          .limit(1),
      );
      if (!q[0]?.config)
        return res
          .status(400)
          .json({
            error: "Save discovery settings before requesting an audit.",
          });
      await checked(
        db()
          .from("discovered_stores")
          .upsert(
            {
              organization_id: res.locals.org,
              domain,
              name: domain,
              source_url: `https://${domain}`,
              source_provider: "audit-request",
            },
            { onConflict: "organization_id,domain", ignoreDuplicates: true },
          ),
      );
      const store = await checked(
        db()
          .from("discovered_stores")
          .select("id")
          .eq("organization_id", res.locals.org)
          .eq("domain", domain)
          .single(),
      );
      const job = await enqueue(res.locals.org, "audit", `audit:${store.id}`, {
        store_id: store.id,
        config: q[0].config,
        requested: true,
      });
      res.status(job ? 202 : 200).json({ domain, job, already_queued: !job });
    }),
  );
  const importSchema = z.object({
    domains: z.array(z.string().max(2000)).min(1).max(50),
    query_id: uuid,
  });
  async function previewImport(org: string, domains: string[]) {
    const seen = new Set<string>();
    const rows = [];
    for (const input of domains) {
      let domain = "";
      try {
        domain = normalizeDomain(input);
      } catch {
        rows.push({ input, domain: "", status: "Invalid domain" });
        continue;
      }
      if (seen.has(domain)) {
        rows.push({ input, domain, status: "Duplicate in file" });
        continue;
      }
      seen.add(domain);
      try {
        await validateTarget(`https://${domain}`);
      } catch {
        rows.push({
          input,
          domain,
          status: "Invalid or unavailable public domain",
        });
        continue;
      }
      const suppressed = await checked(
        db()
          .from("suppression_list")
          .select("id")
          .eq("organization_id", org)
          .eq("domain", domain),
      );
      rows.push({
        input,
        domain,
        status: suppressed.length
          ? "Suppressed"
          : (await discoveryHistory(org, domain))?.seen
            ? "Already researched"
            : "Ready",
      });
    }
    return rows;
  }
  app.post(
    "/api/imports/preview",
    route(async (req, res) => {
      const input = importSchema.parse(req.body);
      await checked(
        db()
          .from("discovery_queries")
          .select("id")
          .eq("organization_id", res.locals.org)
          .eq("id", input.query_id)
          .single(),
      );
      res.json({ rows: await previewImport(res.locals.org, input.domains) });
    }),
  );
  app.post(
    "/api/imports",
    route(async (req, res) => {
      admin(res);
      const input = importSchema.parse(req.body);
      const q = await checked(
        db()
          .from("discovery_queries")
          .select("config")
          .eq("organization_id", res.locals.org)
          .eq("id", input.query_id)
          .single(),
      );
      const rows = await previewImport(res.locals.org, input.domains);
      let queued = 0;
      for (const row of rows.filter((r) => r.status === "Ready")) {
        await validateTarget(`https://${row.domain}`);
        const store = await checked(
          db()
            .from("discovered_stores")
            .upsert(
              {
                organization_id: res.locals.org,
                domain: row.domain,
                name: row.domain,
                source_url: `https://${row.domain}`,
                source_provider: "manual-import",
              },
              { onConflict: "organization_id,domain", ignoreDuplicates: true },
            ),
        );
        const saved = await checked(
          db()
            .from("discovered_stores")
            .select("id")
            .eq("organization_id", res.locals.org)
            .eq("domain", row.domain)
            .single(),
        );
        if (
          await checked(
            db().rpc("enqueue_first_audit", {
              org: res.locals.org,
              store: saved.id,
              config: q.config,
            }),
          )
        )
          queued++;
      }
      res.json({ queued, rows });
    }),
  );
}
