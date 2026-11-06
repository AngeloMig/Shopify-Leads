import type { Snapshot, Lead, Finding } from "../shared/types";
import { defaultSettings } from "../shared/types";
import { buildAlerts, type AlertFeed, type Digest } from "../shared/alerts";
import { leadScoreFor } from "../shared/lead-score";
import type { OperationsSnapshot } from "../shared/automation";
import type { LocalBusiness } from "../shared/local-business";
const rows: [
  string,
  string,
  "US" | "GB" | "CA" | "AU",
  string,
  number,
  number,
  number,
  number,
  number,
  string,
][] = [
  [
    "Northline Living",
    "northline.example",
    "US",
    "Home & furniture",
    38,
    64,
    86,
    88,
    92,
    "N",
  ],
  [
    "Forma Skincare",
    "forma.example",
    "GB",
    "Beauty & skincare",
    29,
    72,
    79,
    82,
    88,
    "f.",
  ],
  [
    "Sunday Supply",
    "sundaysupply.example",
    "AU",
    "Fashion & apparel",
    45,
    68,
    74,
    76,
    84,
    "ss",
  ],
  [
    "Goodkind Goods",
    "goodkind.example",
    "CA",
    "Home decor",
    42,
    76,
    71,
    72,
    78,
    "g",
  ],
  [
    "Morrow & Co.",
    "morrow.example",
    "US",
    "Fashion & apparel",
    51,
    83,
    64,
    68,
    65,
    "M",
  ],
  [
    "Pawprint Studio",
    "pawprint.example",
    "GB",
    "Pet products",
    34,
    70,
    81,
    77,
    0,
    "p",
  ],
  [
    "Gather Pantry",
    "gather.example",
    "AU",
    "Food & beverage",
    61,
    89,
    42,
    58,
    55,
    "ga",
  ],
  [
    "Fieldwork Supply",
    "fieldwork.example",
    "CA",
    "Home & furniture",
    47,
    78,
    66,
    64,
    0,
    "F",
  ],
  [
    "Alba Botanics",
    "alba.example",
    "US",
    "Health & wellness",
    32,
    69,
    83,
    79,
    80,
    "a",
  ],
  [
    "Object Theory",
    "objecttheory.example",
    "GB",
    "Home decor",
    58,
    82,
    52,
    62,
    0,
    "ot",
  ],
  [
    "Kinfolk Pets",
    "kinfolkpets.example",
    "CA",
    "Pet products",
    65,
    91,
    38,
    45,
    45,
    "k",
  ],
  [
    "Daily Ritual",
    "dailyritual.example",
    "AU",
    "Beauty & skincare",
    44,
    74,
    72,
    70,
    0,
    "dr",
  ],
];
const colors = [
  "sage",
  "pink",
  "sand",
  "blue",
  "lavender",
  "rose",
  "orange",
  "mint",
];
export const demoLeads: Lead[] = rows.map((r, i) => {
  const findings: Finding[] = [
    {
      id: `demo-${i}-1`,
      category: "Performance",
      url: `https://${r[1]}/`,
      title: "Reduce unused JavaScript",
      evidence:
        "SYNTHETIC EXAMPLE: Lighthouse flagged unused JavaScript on the mobile homepage. No real website was tested.",
      severity: "high",
      confidence: "high",
      recommendation:
        "Review theme and app scripts, then load nonessential features when needed.",
      kind: "verified",
    },
    {
      id: `demo-${i}-2`,
      category: "Images",
      url: `https://${r[1]}/products/sample`,
      title: "Product images need responsive sizing",
      evidence:
        "SYNTHETIC EXAMPLE: A product image was larger than its displayed dimensions. Sizes and savings are not measured.",
      severity: "medium",
      confidence: "medium",
      recommendation:
        "Check the image sizing pipeline and use appropriate responsive image variants.",
      kind: "hypothesis",
    },
    {
      id: `demo-${i}-3`,
      category: "SEO",
      url: `https://${r[1]}/collections/all`,
      title: "Collection meta description is missing",
      evidence:
        "SYNTHETIC EXAMPLE: No meta description in collection page HTML.",
      severity: "medium",
      confidence: "high",
      recommendation: "Write a clear, collection-specific description.",
      kind: "verified",
    },
  ];
  return {
    id: `demo-${i}`,
    store_id: `demo-store-${i}`,
    name: r[0],
    domain: r[1],
    country: r[2],
    country_evidence: "Synthetic country evidence for interface preview only.",
    industry: r[3],
    performance: r[4],
    seo: r[5],
    desktop: Math.min(r[4] + 30, 98),
    modernization: r[6],
    cro: r[7],
    priority: r[8],
    activity: 90 - (i % 3) * 4,
    stage:
      i < 3 ? "new" : i % 3 === 0 ? "reviewing" : i % 2 ? "hold" : "qualified",
    audited_at: new Date(Date.now() - i * 3600000).toISOString(),
    report_id: `demo-report-${i}`,
    shopify_verified: true,
    findings,
    notes: "",
    owner: i < 4 ? "Alex Chen" : "",
    contact_url: `https://${r[1]}/pages/contact`,
    emails:
      i < 4
        ? [
            {
              email: `hello@${r[1]}`,
              source_url: `https://${r[1]}/pages/contact`,
              observed_at: new Date().toISOString(),
            },
          ]
        : [],
    mail_checks: i < 4 ? { [r[1]]: i === 3 ? "none" : "ok" } : {},
    permission: r[8] > 0 ? "approved" : "unknown",
    suppressed: false,
    color: colors[i % colors.length],
    // Sample evidence so the demo shows how timing and catalog data read.
    catalog:
      i < 8
        ? {
            source_url: `https://${r[1]}/products.json?limit=250`,
            observed_at: new Date().toISOString(),
            product_count: 40 + i * 13,
            count_capped: false,
            newest_published_at: new Date(
              Date.now() - (4 + i * 9) * 86400000,
            ).toISOString(),
            last_updated_at: new Date().toISOString(),
            median_price: 38 + i * 6,
            min_price: 12,
            max_price: 240,
          }
        : null,
    fit:
      i < 4
        ? { status: "fits", reasons: [] }
        : { status: "not_set", reasons: [] },
    timing_signals:
      i < 2
        ? [
            {
              kind: "new_products",
              label: "New products",
              evidence: `Newest product published ${4 + i * 9} days ago.`,
            },
            ...(i === 0
              ? [
                  {
                    kind: "score_drop" as const,
                    label: "Site got slower",
                    evidence:
                      "Mobile performance fell from 52 to 38 since the last audit.",
                  },
                ]
              : []),
          ]
        : [],
  };
});
const demoDigest: Digest = {
  since: new Date(Date.now() - 86400000).toISOString(),
  new_leads: 4,
  audits_completed: 6,
  failed_jobs: 1,
  awaiting_review: demoLeads.length,
  top_leads: demoLeads.slice(0, 3).map((lead) => ({
    id: lead.id,
    name: lead.name,
    score: leadScoreFor(lead).researchScore,
  })),
};
export const demoAlerts: AlertFeed = {
  digest: demoDigest,
  alerts: buildAlerts({
    at: Date.now(),
    workers: [{ state: "working", last_seen: new Date().toISOString() }],
    blocks: [
      {
        provider: "PageSpeed",
        reason:
          "SYNTHETIC EXAMPLE: rate limit reached; retrying after a pause.",
        blocked_until: new Date(Date.now() + 3600000).toISOString(),
      },
    ],
    usage: { units: 42 },
    budgets: { daily_api_budget: 100 },
    failures: [
      { error: "SYNTHETIC EXAMPLE: the store timed out three times." },
    ],
    digest: demoDigest,
  }),
};
export const demoOperations: OperationsSnapshot = {
  server_time: new Date().toISOString(),
  workers: [
    {
      worker_id: "sample-worker",
      last_seen: new Date().toISOString(),
      state: "working",
      job_id: "sample-discovery-01",
    },
  ],
  usage: { units: 42, discovery_units: 12, audit_units: 30 },
  budgets: {
    daily_api_budget: 100,
    discovery_daily_budget: 40,
    audit_daily_budget: 60,
    max_audit_backlog: 5,
    scheduled_runs_per_day: 1,
  },
  blocks: [],
  queue: [],
  schedules: [
    {
      id: "sample-schedule",
      name: "US · Home & furniture",
      enabled: false,
      next_run_at: new Date(Date.now() + 8 * 3600000).toISOString(),
      interval_hours: 24,
    },
  ],
  summary: {
    since: new Date(Date.now() - 6 * 3600000).toISOString(),
    store_tracking_since: new Date(Date.now() - 6 * 3600000).toISOString(),
    stores_found: 18,
    audits_completed: 6,
    new_leads: 4,
    leads_with_email: 3,
    previously_researched: 5,
    duplicate_results: 2,
    duplicate_tracking_searches: 1,
    searches_total: 2,
    failures: 1,
    needs_attention: 1,
    audit_backlog: 0,
  },
};
export const demoSnapshot: Snapshot = {
  leads: demoLeads,
  jobs: [
    {
      id: "sample-discovery-01",
      type: "discovery",
      status: "running",
      progress: 68,
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null,
      attempts: 1,
      max_attempts: 3,
      payload: { name: "US · Home & furniture", sample: true },
      api_usage: { storeleads: 1, pagespeed: 12 },
    },
    {
      id: "sample-audit-02",
      type: "audit",
      status: "completed",
      progress: 100,
      created_at: new Date(Date.now() - 3600000).toISOString(),
      started_at: new Date(Date.now() - 3600000).toISOString(),
      completed_at: new Date(Date.now() - 3000000).toISOString(),
      error: null,
      attempts: 1,
      max_attempts: 3,
      payload: { name: "Northline Living", sample: true },
      api_usage: { pagespeed: 6 },
    },
    {
      id: "sample-audit-03",
      type: "audit",
      status: "failed",
      progress: 15,
      created_at: new Date(Date.now() - 7200000).toISOString(),
      started_at: new Date(Date.now() - 7200000).toISOString(),
      completed_at: new Date(Date.now() - 7000000).toISOString(),
      error: "Synthetic example: storefront timed out after 20 seconds.",
      attempts: 3,
      max_attempts: 3,
      payload: { name: "Example candidate", sample: true },
      api_usage: { pagespeed: 1 },
    },
  ],
  settings: [{ ...defaultSettings, id: "demo-query", enabled: false }],
  candidates: 1248,
  verified: 1062,
  active: 824,
  failed: 3,
  reports: 156,
  organization: { id: "demo", name: "Acme Studio" },
};

// Fictional local businesses for the demo; a live workspace finds them on
// OpenStreetMap through Geoapify.
const local = (
  n: number,
  name: string,
  trade: string,
  city: string,
  check: LocalBusiness["website_check"],
  extra: Partial<LocalBusiness> = {},
): LocalBusiness => ({
  id: `local-${n}`,
  place_id: `demo-place-${n}-example`,
  trade,
  city,
  country: "US",
  name,
  address: `${100 + n * 7} Sample Street, ${city}`,
  phone: `(555) 01${String(n).padStart(2, "0")}-0000`,
  email: null,
  opening_hours: "Mo-Fr 07:00-17:00",
  lat: null,
  lon: null,
  osm_url: null,
  website_check: check,
  found_site: null,
  check_query: `"${name}" ${city}`,
  social_links: [],
  stage: "new",
  notes: "",
  suppressed: false,
  found_at: new Date(Date.UTC(2026, 10, 4 - (n % 4), 15)).toISOString(),
  ...extra,
});
export const demoLocalBusinesses: LocalBusiness[] = [
  local(
    1,
    "Ridgeway Builders",
    "Construction company",
    "Austin, TX",
    "no_site_found",
    {
      social_links: [
        {
          network: "facebook",
          url: "https://www.facebook.com/ridgewaybuilders.example",
        },
        {
          network: "instagram",
          url: "https://www.instagram.com/ridgewaybuilders.example",
        },
      ],
    },
  ),
  local(
    2,
    "Copperline Roofing",
    "Roofing contractor",
    "Austin, TX",
    "no_site_found",
    {
      social_links: [
        {
          network: "facebook",
          url: "https://www.facebook.com/copperlineroofing.example",
        },
      ],
    },
  ),
  local(
    3,
    "Bluebonnet Concrete Co.",
    "Concrete or paving",
    "Round Rock, TX",
    "no_site_found",
    {
      phone: null,
    },
  ),
  local(4, "Hilltop Carpentry", "Carpenter", "Austin, TX", "no_site_found", {
    social_links: [
      {
        network: "instagram",
        url: "https://www.instagram.com/hilltopcarpentry.example",
      },
    ],
    stage: "contacted",
  }),
  local(
    5,
    "Lakeview Remodeling",
    "Construction company",
    "Round Rock, TX",
    "not_checked",
  ),
  local(
    6,
    "Summit Stone Masonry",
    "Concrete or paving",
    "Austin, TX",
    "site_found",
    {
      found_site: "summitstonemasonry.example",
    },
  ),
];
