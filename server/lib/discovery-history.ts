import { checked, db } from "./db.js";

/** Full retained workspace history, independent of a provider's recent cursor. */
export async function discoveryHistory(
  organization_id: string,
  domain: string,
) {
  const store = await checked(
    db()
      .from("discovered_stores")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("domain", domain)
      .maybeSingle(),
  );
  if (!store) return null;
  const [audit, job] = await Promise.all([
    checked(
      db()
        .from("audit_runs")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("store_id", store.id)
        .limit(1)
        .maybeSingle(),
    ),
    checked(
      db()
        .from("automation_jobs")
        .select("id")
        .eq("organization_id", organization_id)
        .eq("type", "audit")
        .contains("payload", { store_id: store.id })
        .limit(1)
        .maybeSingle(),
    ),
  ]);
  // A crash between saving a store and enqueueing its first audit must remain
  // recoverable. Actual queued/attempted audits, of any status, are history.
  return { store_id: store.id as string, seen: !!audit || !!job };
}
