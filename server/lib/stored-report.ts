import { checked, db } from "./db.js";
import {
  createReport,
  reportVersion,
  reportAgency,
  type ReportInput,
} from "../modules/report.js";
import type {
  Finding,
  PublicEmail,
  Recommendation,
} from "../../shared/types.js";
import type { PsiSample } from "../modules/providers.js";

/** Rebuild from retained evidence only; never calls a discovery/audit provider. */
export async function savedReportInput(
  organization_id: string,
  report_id: string,
) {
  const report = await checked(
    db()
      .from("reports")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("id", report_id)
      .single(),
  );
  const [
    store,
    audit,
    scores,
    metrics,
    findings,
    pages,
    recommendations,
    contacts,
    organization,
  ] = await Promise.all([
    checked(
      db()
        .from("discovered_stores")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("id", report.store_id)
        .single(),
    ),
    checked(
      db()
        .from("audit_runs")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("id", report.audit_id)
        .single(),
    ),
    checked(
      db()
        .from("lead_scores")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("audit_id", report.audit_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    checked(
      db()
        .from("audit_metrics")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("audit_id", report.audit_id)
        .order("strategy")
        .order("sample"),
    ),
    checked(
      db()
        .from("audit_findings")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("audit_id", report.audit_id)
        .order("created_at"),
    ),
    checked(
      db()
        .from("audit_pages")
        .select("url,kind,status_code,metadata")
        .eq("organization_id", organization_id)
        .eq("audit_id", report.audit_id),
    ),
    checked(
      db()
        .from("ai_recommendations")
        .select("recommendation")
        .eq("organization_id", organization_id)
        .eq("audit_id", report.audit_id),
    ),
    checked(
      db()
        .from("contacts")
        .select("route,source_url,verified_at")
        .eq("organization_id", organization_id)
        .eq("store_id", report.store_id),
    ),
    checked(
      db()
        .from("organizations")
        .select("name")
        .eq("id", organization_id)
        .single(),
    ),
  ]);
  if (audit.status !== "completed")
    throw new Error("Only completed audits have publishable reports");
  const input: ReportInput = {
    name: store.name,
    domain: store.domain,
    audit_id: audit.id,
    date: audit.completed_at ?? report.created_at,
    findings: findings as Finding[],
    samples: metrics as PsiSample[],
    recommendations: recommendations.map(
      (row) => row.recommendation,
    ) as Recommendation[],
    activity: scores?.activity ?? audit.summary?.activity ?? null,
    priority: scores?.priority ?? 0,
    modernization: scores?.modernization ?? null,
    technologies: [
      ...new Set(
        pages.flatMap((page) =>
          Array.isArray(page.metadata?.technologies)
            ? page.metadata.technologies.map(
                (entry: { vendor: string }) => entry.vendor,
              )
            : [],
        ),
      ),
    ] as string[],
    history: audit.summary?.history ?? "Historical comparison not recorded.",
    agency: reportAgency(organization.name),
    country: store.country,
    country_evidence: store.country_evidence,
    contacts: contacts
      .filter((contact) => /^mailto:[^?\s]+@[^?\s]+$/i.test(contact.route))
      .map((contact) => ({
        email: contact.route.slice(7),
        source_url: contact.source_url,
        observed_at: contact.verified_at,
      })) as PublicEmail[],
    pages: pages
      .filter((page) => page.kind !== "browser-diagnostics")
      .map(({ url, kind, status_code }) => ({ url, kind, status_code })),
    page_limitations: audit.summary?.page_limitations ?? [],
  };
  return { report, input };
}
export async function publishSavedReport(
  organization_id: string,
  report_id: string,
  prepared?: Awaited<ReturnType<typeof savedReportInput>>,
  pdf?: Buffer,
) {
  const source =
    prepared ?? (await savedReportInput(organization_id, report_id));
  if (
    source.report.organization_id !== organization_id ||
    source.report.id !== report_id
  )
    throw new Error("Report workspace mismatch");
  const path = `${organization_id}/${source.report.audit_id}/report-${reportVersion}.pdf`;
  await checked(
    db()
      .storage.from("audit-artifacts")
      .upload(path, pdf ?? (await createReport(source.input)), {
        contentType: "application/pdf",
        upsert: true,
      }),
  );
  // Publish only after upload succeeds; preserve the original PDF object.
  await checked(
    db()
      .from("reports")
      .update({ storage_path: path })
      .eq("organization_id", organization_id)
      .eq("id", report_id),
  );
  return path;
}
