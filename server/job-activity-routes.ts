import type { Express } from "express";
import { checked, db, now } from "./lib/db.js";
import { uuid } from "./lib/validation.js";
import { observedFinalization } from "../shared/research-tasks.js";
import { readWork, type WorkTarget } from "../shared/job-activity.js";
export function registerJobActivityRoutes(app: Express) {
  app.get("/api/jobs/:id/activity", async (req, res, next) => {
    try {
      const org = res.locals.org,
        id = uuid.parse(req.params.id);
      const job = await checked(
        db()
          .from("automation_jobs")
          .select("*")
          .eq("organization_id", org)
          .eq("id", id)
          .maybeSingle(),
      );
      if (!job)
        return res
          .status(404)
          .json({ error: "This run is not available in your workspace." });
      const work = readWork(job.payload.work);
      let target: WorkTarget = work?.target ?? {
        label: job.type === "discovery" ? "Store discovery" : "Website audit",
      };
      let auditId: string | null = null;
      if (uuid.safeParse(job.payload.store_id).success) {
        const store = await checked(
          db()
            .from("discovered_stores")
            .select("id,name,display_name,domain")
            .eq("organization_id", org)
            .eq("id", job.payload.store_id)
            .maybeSingle(),
        );
        if (store)
          target = {
            ...target,
            label: store.display_name || store.name,
            domain: store.domain,
            url: `https://${store.domain}/`,
          };
        const candidateId = work?.target.audit_id ?? job.payload.audit_id;
        if (uuid.safeParse(candidateId).success) {
          const audit = await checked(
            db()
              .from("audit_runs")
              .select("id")
              .eq("organization_id", org)
              .eq("store_id", job.payload.store_id)
              .eq("id", candidateId)
              .maybeSingle(),
          );
          auditId = audit?.id ?? null;
        }
      } else if (uuid.safeParse(job.payload.query_id).success) {
        const campaign = await checked(
          db()
            .from("discovery_queries")
            .select("name")
            .eq("organization_id", org)
            .eq("id", job.payload.query_id)
            .maybeSingle(),
        );
        if (campaign) target = { ...target, label: campaign.name };
      }
      const [pages, measurements, findings, report] = auditId
        ? await Promise.all([
            checked(
              db()
                .from("audit_pages")
                .select("url,kind,status_code")
                .eq("organization_id", org)
                .eq("audit_id", auditId)
                .limit(12),
            ),
            checked(
              db()
                .from("audit_metrics")
                .select("strategy,sample,tested_at,scores")
                .eq("organization_id", org)
                .eq("audit_id", auditId)
                .order("strategy")
                .order("sample")
                .limit(6),
            ),
            checked(
              db()
                .from("audit_findings")
                .select("title,category,severity,url")
                .eq("organization_id", org)
                .eq("audit_id", auditId)
                .eq("kind", "verified")
                .limit(12),
            ),
            checked(
              db()
                .from("reports")
                .select("id")
                .eq("organization_id", org)
                .eq("audit_id", auditId)
                .maybeSingle(),
            ),
          ])
        : [[], [], [], null];
      res.setHeader("Cache-Control", "no-store");
      res.json({
        job: {
          ...job,
          payload: {
            ...job.payload,
            work:
              observedFinalization(job, report?.id ?? null) ?? job.payload.work,
          },
        },
        target,
        server_time: now(),
        pages,
        measurements,
        findings,
        report_id: report?.id ?? null,
      });
    } catch (error) {
      next(error);
    }
  });
}
