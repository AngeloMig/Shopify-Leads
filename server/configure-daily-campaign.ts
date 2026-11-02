import { db, checked, insert } from "./lib/db.js";
import { uuid, settingsSchema } from "./lib/validation.js";
import { defaultSettings } from "../shared/types.js";
import { skincareCampaignKeywords } from "../shared/discovery-keywords.js";
const org = uuid.parse(process.argv[2]);
const settings = await checked(
  db()
    .from("app_settings")
    .select("config")
    .eq("organization_id", org)
    .maybeSingle(),
);
const previous = await checked(
  db()
    .from("discovery_queries")
    .select("id,config")
    .eq("organization_id", org)
    .order("created_at")
    .limit(1),
);
const name = "Australian skincare · daily";
const matches = await checked(
  db()
    .from("discovery_queries")
    .select("id,config")
    .eq("organization_id", org)
    .eq("name", name),
);
if (matches.length > 1)
  throw new Error(
    "More than one matching campaign exists. Select the intended campaign before changing schedules.",
  );
const limits = settings?.config ?? {};
const config = settingsSchema.parse({
  ...defaultSettings,
  ...previous[0]?.config,
  ...limits,
  name,
  provider: "tavily",
  countries: ["AU"],
  industries: ["Beauty & skincare"],
  keywords: skincareCampaignKeywords.join(", "),
  keyword_library: false,
  batch_size: 3,
  searches_per_run: 1,
  interval_hours: 24,
  enabled: true,
  mobile_threshold: 75,
  seo_threshold: 85,
  include_frontend_findings: true,
  max_audit_backlog: 5,
  scheduled_runs_per_day: 1,
});
const next = new Date();
next.setUTCHours(24, 0, 0, 0);
const row = {
  organization_id: org,
  name,
  config,
  enabled: true,
  interval_hours: 24,
  next_run_at: next.toISOString(),
};
const campaign = matches[0]
  ? await checked(
      db()
        .from("discovery_queries")
        .update(row)
        .eq("organization_id", org)
        .eq("id", matches[0].id)
        .select("id")
        .single(),
    )
  : await insert("discovery_queries", row);
await checked(
  db()
    .from("app_settings")
    .upsert(
      {
        organization_id: org,
        config: { ...limits, max_audit_backlog: 5, scheduled_runs_per_day: 1 },
      },
      { onConflict: "organization_id" },
    ),
);
console.info(
  JSON.stringify({
    campaign: campaign.id,
    name,
    next_eligible: next.toISOString(),
    stores: 3,
    searches: 1,
    budgets_preserved: true,
  }),
);
