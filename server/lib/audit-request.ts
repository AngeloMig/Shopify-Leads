// A requested audit: one website someone asked about. It runs the same audit
// and PDF as discovered leads, without the prospecting checks. Used by the
// "Audit a website" dialog and by the tracker sync (free-audit requests).
import { db, checked } from "./db.js";
import { normalizeDomain, validateTarget } from "./network.js";
import { enqueue } from "../pipeline.js";

export class AuditRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
  }
}

export async function queueRequestedAudit(
  org: string,
  url: string,
  extra: Record<string, unknown> = {},
) {
  let domain: string;
  try {
    domain = normalizeDomain(url);
    await validateTarget(`https://${domain}`);
  } catch {
    throw new AuditRequestError(
      "Enter a public website address, like store.com.",
      400,
    );
  }
  const suppressed = await checked(
    db()
      .from("suppression_list")
      .select("id")
      .eq("organization_id", org)
      .eq("domain", domain),
  );
  if (suppressed.length)
    throw new AuditRequestError(
      "This website opted out. It can't be audited.",
      409,
    );
  const q = await checked(
    db()
      .from("discovery_queries")
      .select("config")
      .eq("organization_id", org)
      .order("created_at")
      .limit(1),
  );
  if (!q[0]?.config)
    throw new AuditRequestError(
      "Save discovery settings before requesting an audit.",
      400,
    );
  await checked(
    db()
      .from("discovered_stores")
      .upsert(
        {
          organization_id: org,
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
      .eq("organization_id", org)
      .eq("domain", domain)
      .single(),
  );
  const key = `audit:${store.id}`;
  const job = await enqueue(org, "audit", key, {
    store_id: store.id,
    config: q[0].config,
    requested: true,
    ...extra,
  });
  // An audit of this store is already queued or running: let it carry the
  // extra fields too (e.g. which tracker inquiry is waiting for it).
  if (!job && Object.keys(extra).length) {
    const active = await checked(
      db()
        .from("automation_jobs")
        .select("id,payload")
        .eq("organization_id", org)
        .eq("dedupe_key", key)
        .in("status", ["queued", "running", "blocked"])
        .limit(1),
    );
    if (active[0])
      await checked(
        db()
          .from("automation_jobs")
          .update({
            payload: { ...active[0].payload, requested: true, ...extra },
          })
          .eq("id", active[0].id),
      );
  }
  return { domain, store_id: store.id as string, job };
}
