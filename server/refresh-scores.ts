import { db, checked } from "./lib/db.js";
import { uuid } from "./lib/validation.js";
import { checkMailDomains } from "./lib/mail-domain.js";
import { leadScore } from "../shared/lead-score.js";

/** Recalculates saved scores from retained evidence. Its only lookups are free DNS mail checks. */
const org = uuid.parse(process.argv[2]);
const dryRun = process.argv.includes("--dry-run");
const leads = await checked(
  db().from("leads").select("id,store_id,audit_id").eq("organization_id", org),
);
const suppressed = await checked(
  db().from("suppression_list").select("domain").eq("organization_id", org),
);
const scored: {
  domain: string;
  before: number;
  after: number;
  noMail: string[];
}[] = [];
for (const lead of leads) {
  const [store, scores, findings, contacts, reviews] = await Promise.all([
    checked(
      db()
        .from("discovered_stores")
        .select(
          "domain,name,activity,contact_url,country,country_evidence,shopify_verified",
        )
        .eq("organization_id", org)
        .eq("id", lead.store_id)
        .single(),
    ),
    checked(
      db()
        .from("lead_scores")
        .select("id,performance,breakdown")
        .eq("organization_id", org)
        .eq("audit_id", lead.audit_id)
        .order("created_at", { ascending: false })
        .limit(1),
    ),
    checked(
      db()
        .from("audit_findings")
        .select("kind,severity,category")
        .eq("organization_id", org)
        .eq("audit_id", lead.audit_id),
    ),
    checked(
      db()
        .from("contacts")
        .select("route")
        .eq("organization_id", org)
        .eq("store_id", lead.store_id),
    ),
    checked(
      db()
        .from("contact_permission_reviews")
        .select("status,expires_at")
        .eq("organization_id", org)
        .eq("store_id", lead.store_id)
        .order("reviewed_at", { ascending: false })
        .limit(1),
    ),
  ]);
  const row = scores[0];
  if (!row) continue;
  const breakdown = row.breakdown ?? {};
  const emails = contacts
    .filter((c) => /^mailto:[^?\s]+@[^?\s]+$/i.test(c.route))
    .map((c) => ({ email: c.route.slice(7) }));
  const mail = { ...breakdown.mail, ...(await checkMailDomains(emails)) };
  const result = leadScore({
    findings,
    performance: row.performance,
    activity: store.activity,
    emails,
    mail,
    contact_url: store.contact_url,
    domain: store.domain,
    title: store.name,
    brand_evidence: breakdown.brand ?? null,
    catalog: breakdown.catalog ?? null,
    fit: breakdown.fit ?? null,
    timing: breakdown.timing ?? [],
    countryVerified: !!store.country && !!store.country_evidence,
    shopifyVerified: store.shopify_verified,
    permissionApproved:
      reviews[0]?.status === "approved" &&
      new Date(reviews[0].expires_at) > new Date(),
    suppressed: suppressed.some((s) => s.domain === store.domain),
  });
  scored.push({
    domain: store.domain,
    before: breakdown.researchScore ?? 0,
    after: result.researchScore,
    noMail: Object.keys(mail).filter((domain) => mail[domain] === "none"),
  });
  if (!dryRun)
    await checked(
      db()
        .from("lead_scores")
        .update({
          priority: result.priority,
          breakdown: { ...breakdown, ...result, mail },
        })
        .eq("organization_id", org)
        .eq("id", row.id),
    );
}
scored.sort((a, b) => b.after - a.after);
for (const s of scored)
  console.info(
    `${String(s.after).padStart(3)} (was ${s.before})  ${s.domain}${s.noMail.length ? `  no mail: ${s.noMail.join(", ")}` : ""}`,
  );
console.info(
  `${dryRun ? "Dry run, nothing saved" : "Saved"}: ${scored.length} scores.`,
);
process.exit(0);
