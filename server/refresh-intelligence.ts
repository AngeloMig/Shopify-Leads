import { db, checked } from "./lib/db.js";
import { uuid } from "./lib/validation.js";
import {
  classifyIndustry,
  shortBusinessName,
} from "../shared/lead-intelligence.js";
const org = uuid.parse(process.argv[2]);
const stores = await checked(
  db()
    .from("discovered_stores")
    .select("id,domain,name,display_name,industry_manual")
    .eq("organization_id", org),
);
for (const store of stores) {
  if (!store.display_name)
    await checked(
      db()
        .from("discovered_stores")
        .update({ display_name: shortBusinessName(store.name, store.domain) })
        .eq("organization_id", org)
        .eq("id", store.id)
        .is("display_name", null),
    );
  if (store.industry_manual) continue;
  const audits = await checked(
    db()
      .from("audit_runs")
      .select("id")
      .eq("organization_id", org)
      .eq("store_id", store.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1),
  );
  if (!audits.length) continue;
  const pages = await checked(
    db()
      .from("audit_pages")
      .select("metadata")
      .eq("organization_id", org)
      .eq("audit_id", audits[0].id),
  );
  const classification = classifyIndustry(
    pages.map((p) => p.metadata).filter(Boolean),
  );
  await checked(
    db()
      .from("discovered_stores")
      .update(classification)
      .eq("organization_id", org)
      .eq("id", store.id)
      .eq("industry_manual", false),
  );
  console.info(
    `${store.domain}: ${classification.industry} (${classification.industry_confidence})`,
  );
}

const configs = await checked(
  db()
    .from("discovery_queries")
    .select("config")
    .eq("organization_id", org)
    .order("created_at")
    .limit(1),
);
const existing = await checked(
  db()
    .from("app_settings")
    .select("config")
    .eq("organization_id", org)
    .maybeSingle(),
);
if (configs.length)
  await checked(
    db()
      .from("app_settings")
      .upsert(
        {
          organization_id: org,
          config: {
            daily_api_budget: configs[0].config.daily_api_budget,
            discovery_daily_budget: configs[0].config.daily_api_budget,
            audit_daily_budget: configs[0].config.daily_api_budget,
            ...existing?.config,
          },
        },
        { onConflict: "organization_id" },
      ),
  );
