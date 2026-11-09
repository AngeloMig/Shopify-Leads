import type { CatalogEvidence, FitResult, IdealClient } from "./catalog.js";
import type { MailChecks } from "./lead-intelligence.js";
import type { TimingSignal } from "./lead-score.js";
import type { BrandEvidence } from "./brand-size.js";
import type { ContactPerson, ContactState } from "./contact-log.js";

export type Country = "US" | "GB" | "CA" | "AU";
export type Stage = "new" | "reviewing" | "qualified" | "hold" | "suppressed";
export type LeadOutcome = "won" | "lost";
/** "Not a fit" also teaches search learning to avoid similar queries. */
export const lostReasons = [
  "No response",
  "No budget",
  "Chose someone else",
  "Bad timing",
  "Not a fit",
  "Other",
] as const;
export type Finding = {
  id: string;
  category: string;
  url: string;
  title: string;
  evidence: string;
  severity: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  recommendation: string;
  kind: "verified" | "hypothesis" | "idea";
};
export type PsiSample = {
  url: string;
  strategy: "mobile" | "desktop";
  sample: number;
  tested_at: string;
  environment?: {
    lighthouse_version: string | null;
    form_factor: string | null;
    throttling_method: string | null;
  };
  scores: Record<string, number | null>;
  diagnostics: Record<string, unknown>;
  field_data: {
    available: boolean;
    scope: "page" | "origin" | "unavailable";
    metrics: Record<string, unknown>;
  };
};
export type Recommendation = {
  finding_ids: string[];
  category: string;
  url: string;
  observed_finding: string;
  supporting_evidence: string;
  confidence: string;
  potential_impact: string;
  improvement: string;
  service: string;
  difficulty: "low" | "medium" | "high";
  merchant_access_required: boolean;
  kind: "recommendation";
};
export type PublicEmail = {
  email: string;
  source_url: string;
  observed_at?: string;
};
export type Lead = {
  id: string;
  store_id: string;
  domain: string;
  name: string;
  original_name?: string;
  display_name?: string | null;
  preferred_email?: string | null;
  industry_confidence?: string;
  industry_evidence?: string | null;
  country: Country | null;
  country_evidence?: string;
  industry: string;
  activity: number | null;
  seo: number | null;
  performance: number | null;
  desktop: number | null;
  modernization: number | null;
  cro: number | null;
  priority: number;
  stage: Stage;
  audited_at: string | null;
  report_id?: string;
  shopify_verified: boolean;
  findings: Finding[];
  /** From a list: findings have no url, evidence or recommendation text yet. */
  evidence_summary?: true;
  recommendations?: Recommendation[];
  notes: string;
  owner: string;
  contact_url?: string;
  emails?: PublicEmail[];
  permission: "unknown" | "approved" | "rejected";
  suppressed: boolean;
  color?: string;
  catalog?: CatalogEvidence | null;
  fit?: FitResult | null;
  timing_signals?: TimingSignal[];
  /** Home page links and locales the brand-size check reads. */
  brand_evidence?: BrandEvidence | null;
  mail_checks?: MailChecks;
  outcome?: LeadOutcome | null;
  /** The latest time you got in touch, and when to follow up. */
  contact?: ContactState | null;
  /** Who to write to, as you set it: "Hi Jamie," instead of "Hi team,". */
  contact_person?: ContactPerson | null;
  /** Moved to the KNB tracker's Inquiries after a reply; it carries on there. */
  tracker?: { inquiry_id: string; url: string | null } | null;
  /** Added by "Audit a website" or a free-audit request, not found by discovery. */
  requested?: boolean;
  outcome_reason?: string | null;
  outcome_at?: string | null;
};
export type Job = {
  id: string;
  type: "discovery" | "audit";
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "blocked";
  available_at?: string;
  wait_reason?: string | null;
  error_code?: string | null;
  error_provider?: string | null;
  progress: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  api_usage: Record<string, number>;
};
export type DiscoverySettings = {
  id?: string;
  name: string;
  provider: "storeleads" | "brave" | "tavily";
  countries: Country[];
  industries: string[];
  keywords: string;
  keyword_library?: boolean;
  searches_per_run?: number;
  batch_size: number;
  interval_hours: number;
  enabled: boolean;
  mobile_threshold: number;
  seo_threshold: number;
  modernization_threshold: number;
  daily_api_budget: number;
  discovery_daily_budget?: number;
  audit_daily_budget?: number;
  max_audit_backlog?: number;
  scheduled_runs_per_day?: number;
  excluded_domains?: string[];
  adaptive_queries?: boolean;
  include_frontend_findings?: boolean;
  ideal_client?: IdealClient | null;
  retention_days: number;
  history_months: number;
  modules: { browser: boolean; history: boolean; ai: boolean };
  next_run_at?: string;
};
/** A website someone asked to have audited (Free audits), and where it is. */
export type AuditRequest = {
  store_id: string;
  domain: string;
  job_id: string;
  requested_at: string;
  status: "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled";
  error: string | null;
  /** From the tracker's free-audit form; null when added here. */
  tracker: { inquiry_id: string; url: string | null } | null;
  /** The finished audit, once there is one. */
  lead: Lead | null;
};
export type Snapshot = {
  leads: Lead[];
  /** Free audits: kept apart from the prospects in leads. */
  requests?: AuditRequest[];
  jobs: Job[];
  settings: DiscoverySettings[];
  candidates: number;
  verified: number;
  active: number;
  failed: number;
  reports: number;
  organization: { id: string; name: string };
};
export const defaultSettings: DiscoverySettings = {
  name: "Shopify opportunity research",
  provider: "storeleads",
  countries: ["US", "GB", "CA", "AU"],
  industries: ["Home & furniture", "Fashion & apparel", "Beauty & skincare"],
  keywords: "",
  keyword_library: true,
  searches_per_run: 1,
  batch_size: 10,
  interval_hours: 24,
  enabled: false,
  mobile_threshold: 49,
  seo_threshold: 80,
  modernization_threshold: 60,
  daily_api_budget: 100,
  retention_days: 365,
  history_months: 24,
  modules: { browser: false, history: false, ai: false },
};
// Moderate issues, with room for several verified stores from one search.
export const moderateScreening = {
  batch_size: 10,
  mobile_threshold: 75,
  seo_threshold: 85,
  modernization_threshold: 50,
  include_frontend_findings: true,
} as const;
export type SearchSummary = {
  query: string;
  keyword: string;
  country: Country;
  industry: string;
  returned: number;
  excluded: number;
  invalid: number;
  duplicates: number;
  candidates: number;
  format?: string;
  credits?: number;
  credits_measured?: boolean;
};
export type DiscoveryFunnel = {
  search_limit: number;
  searches: SearchSummary[];
  returned: number;
  candidates: number;
  checked: number;
  shopify: number;
  active: number;
  country: number;
  queued: number;
  previously_researched: number;
  suppressed: number;
  rejections: string[];
  saved_used?: number;
  cooldown_skipped?: number;
  outside_fit?: number;
};
export const countryNames: Record<Country, string> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
};
export const industries = [
  "Home & furniture",
  "Fashion & apparel",
  "Food & beverage",
  "Beauty & skincare",
  "Electronics",
  "Health & wellness",
  "Home decor",
  "Pet products",
  "Other",
];
