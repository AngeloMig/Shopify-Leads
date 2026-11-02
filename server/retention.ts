import { checked, db } from "./lib/db.js";
/** Remove expired evidence and private artifacts; opt-out/suppression records remain. */
export async function purgeExpiredResearch() {
  await checked(
    db()
      .from("discovery_rejections")
      .delete()
      .lt("retry_at", new Date(Date.now() - 30 * 86400000).toISOString()),
  );
  await checked(
    db()
      .from("job_checkpoints")
      .delete()
      .lt("saved_at", new Date(Date.now() - 86400000).toISOString()),
  );
  const settings = await checked(
    db().from("app_settings").select("organization_id,config"),
  );
  for (const setting of settings) {
    const days = Number(setting.config.retention_days);
    if (!Number.isInteger(days) || days < 30 || days > 3650) continue;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    await checked(
      db()
        .from("candidate_reviews")
        .delete()
        .eq("organization_id", setting.organization_id)
        .lt("created_at", cutoff),
    );
    await checked(
      db()
        .from("discovery_searches")
        .delete()
        .eq("organization_id", setting.organization_id)
        .eq("completed", true)
        .lt("created_at", cutoff),
    );
    const stores = await checked(
      db()
        .from("discovered_stores")
        .select("id")
        .eq("organization_id", setting.organization_id)
        .lt("researched_at", cutoff)
        .limit(25),
    );
    for (const store of stores) {
      const active = await checked(
        db()
          .from("automation_jobs")
          .select("id")
          .eq("organization_id", setting.organization_id)
          .in("status", ["queued", "running", "blocked"])
          .contains("payload", { store_id: store.id })
          .limit(1),
      );
      if (active.length) continue;
      const audits = await checked(
        db()
          .from("audit_runs")
          .select("id")
          .eq("organization_id", setting.organization_id)
          .eq("store_id", store.id),
      );
      for (const audit of audits) {
        // The prefix is owned by this organization/audit and contains reports and screenshots.
        const files = await checked(
          db()
            .storage.from("audit-artifacts")
            .list(`${setting.organization_id}/${audit.id}`, { limit: 100 }),
        );
        const paths = files.map(
          (f) => `${setting.organization_id}/${audit.id}/${f.name}`,
        );
        if (paths.length)
          await checked(db().storage.from("audit-artifacts").remove(paths));
      }
      await checked(
        db()
          .from("discovered_stores")
          .delete()
          .eq("id", store.id)
          .eq("organization_id", setting.organization_id),
      );
    }
  }
}
