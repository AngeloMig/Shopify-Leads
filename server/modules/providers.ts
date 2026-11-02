import {
  providerJson,
  normalizeDomain,
  validateTarget,
} from "../lib/network.js";
import {
  countryNames,
  type DiscoverySettings,
  type Country,
  type SearchSummary,
  type PsiSample,
} from "../../shared/types.js";
import {
  planSearch,
  storefrontPriority,
  tavilyExclusions,
  type QueryOutcome,
} from "../../shared/discovery-search.js";
export type Candidate = {
  domain: string;
  name: string;
  country: Country | null;
  country_evidence: string | null;
  industry: string;
  source_url: string;
  source_provider: string;
  priority?: number;
  search_country?: Country;
  search_industry?: string;
};
export type Charge = (provider: string) => Promise<void>;
export async function discover(
  config: DiscoverySettings,
  charge: Charge,
  cursor?: string | null,
  avoid: { country: string; industry: string; keyword: string }[] = [],
  options: {
    processed?: string[];
    outcomes?: QueryOutcome[];
    onQuery?: (plan: ReturnType<typeof planSearch>) => Promise<void>;
  } = {},
): Promise<{
  candidates: Candidate[];
  nextCursor: string | null;
  summary?: SearchSummary;
}> {
  if (config.provider === "tavily")
    return discoverTavily(config, charge, cursor, avoid, options);
  const found = new Map<string, Candidate>();
  let nextCursor: string | null = null;
  for (const country of config.countries) {
    if (found.size >= config.batch_size) break;
    if (config.provider === "storeleads") {
      if (!process.env.STORE_LEADS_API_KEY)
        throw new Error(
          "STORE_LEADS_API_KEY is not configured. Store Leads requires API account access.",
        );
      const url = new URL("https://storeleads.app/json/api/v1/all/domain");
      url.searchParams.set("f:p", "shopify");
      url.searchParams.set("f:cc", config.countries.join(","));
      url.searchParams.set("f:cc:op", "or");
      url.searchParams.set("page_size", String(config.batch_size));
      if (cursor) url.searchParams.set("cursor", cursor);
      const categoryMap: Record<string, string> = {
        "Home & furniture": "/Home & Garden",
        "Fashion & apparel": "/Apparel",
        "Food & beverage": "/Food & Drink",
        "Beauty & skincare": "/Beauty & Fitness",
        Electronics: "/Consumer Electronics",
        "Health & wellness": "/Health",
        "Home decor": "/Home & Garden",
        "Pet products": "/Pets & Animals",
      };
      const categories = [
        ...new Set(
          config.industries.map((i) => categoryMap[i]).filter(Boolean),
        ),
      ];
      if (categories.length && !config.industries.includes("Other")) {
        url.searchParams.set("f:cat", categories.join(","));
        url.searchParams.set("f:cat:op", "or");
      }
      if (config.keywords) url.searchParams.set("q", config.keywords);
      await charge("storeleads");
      const data = await providerJson(url.href, {
        headers: { Authorization: `Bearer ${process.env.STORE_LEADS_API_KEY}` },
      });
      if (!Array.isArray(data.domains))
        throw new Error("Unexpected Store Leads response");
      nextCursor =
        typeof data.next_cursor === "string" ? data.next_cursor : null;
      for (const row of data.domains) {
        try {
          const domain = normalizeDomain(row.name);
          const cc = config.countries.includes(row.country_code)
            ? row.country_code
            : null;
          found.set(domain, {
            domain,
            name: row.merchant_name || domain,
            country: cc,
            country_evidence: cc
              ? `Store Leads country_code=${cc}; ${url.href}`
              : null,
            industry: Array.isArray(row.categories)
              ? row.categories.join(", ")
              : "Unknown",
            source_url: url.href,
            source_provider: "storeleads",
          });
        } catch {
          /* invalid provider record excluded */
        }
      }
      break; // One request covers all selected countries.
    } else if (config.provider === "brave") {
      if (!process.env.BRAVE_SEARCH_API_KEY)
        throw new Error(
          "BRAVE_SEARCH_API_KEY is not configured. Brave Search API account required.",
        );
      if (process.env.BRAVE_STORAGE_ALLOWED !== "true")
        throw new Error(
          "Brave discovery saves API-derived research. Confirm storage rights with Brave, then set BRAVE_STORAGE_ALLOWED=true.",
        );
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set(
        "q",
        `"powered by Shopify" ${config.industries.join(" OR ")} ${config.keywords}`,
      );
      url.searchParams.set("country", country);
      const offset = Math.min(9, Math.max(0, Number(cursor) || 0));
      url.searchParams.set("offset", String(offset));
      nextCursor = String((offset + 1) % 10);
      url.searchParams.set("count", String(Math.min(config.batch_size, 20)));
      await charge("brave");
      const data = await providerJson(url.href, {
        headers: { "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY },
      });
      for (const row of data.web?.results ?? []) {
        try {
          const domain = normalizeDomain(row.url);
          found.set(domain, {
            domain,
            name: row.title || domain,
            country: null,
            country_evidence: null,
            industry: "Unknown",
            source_url: row.url,
            source_provider: "brave",
          });
        } catch {
          /* invalid search URL excluded */
        }
      }
    }
    if (config.countries.length > 1)
      await new Promise((r) => setTimeout(r, 600));
  }
  return {
    candidates: [...found.values()].slice(0, config.batch_size),
    nextCursor,
  };
}

async function discoverTavily(
  config: DiscoverySettings,
  charge: Charge,
  cursor?: string | null,
  avoid: { country: string; industry: string; keyword: string }[] = [],
  options: {
    processed?: string[];
    outcomes?: QueryOutcome[];
    onQuery?: (plan: ReturnType<typeof planSearch>) => Promise<void>;
  } = {},
) {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key)
    throw new Error(
      "TAVILY_API_KEY is not configured. Add your Tavily key to the server environment.",
    );
  let step = 0;
  try {
    const saved = JSON.parse(cursor || "null");
    const value = saved?.v === 1 ? saved.query : saved?.step;
    if (Number.isSafeInteger(value) && value >= 0) step = value;
    // Old cursors mixed unchecked results with exclusions. Deliberately discard
    // that list; verified history and the persistent candidate queue replace it.
  } catch {
    /* Invalid cursors restart rotation, never bypass history. */
  }
  let plan = planSearch(config, step, options.outcomes);
  if (config.adaptive_queries !== false)
    for (
      let skips = 0;
      skips < 8 &&
      avoid.some(
        (v) =>
          v.country === plan.country &&
          v.industry === plan.industry &&
          v.keyword === plan.keyword,
      );
      skips++
    ) {
      step++;
      plan = planSearch(config, step, options.outcomes);
    }
  const { query, keyword, country, industry, format } = plan;
  const location = countryNames[country];
  const excludedSources = [
    "shopify.com",
    "analyzify.com",
    "storeleads.app",
    "builtwith.com",
    "reddit.com",
    "youtube.com",
    "pinterest.com",
    "linkedin.com",
    "etsy.com",
    "pagefly.io",
    "skailama.com",
    "magenest.com",
    "sitebuilderreport.com",
    "eachspy.com",
    "expertmarket.com",
    "setubridge.com",
    "gq.com",
  ];
  const exclusions = tavilyExclusions(
    config.excluded_domains ?? [],
    excludedSources,
    options.processed ?? [],
  );
  await options.onQuery?.(plan);
  await charge("tavily");
  const data = await providerJson("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      topic: "general",
      country: location.toLowerCase(),
      search_depth: "basic",
      auto_parameters: false,
      max_results: 20,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_usage: true,
      exclude_domains: exclusions,
    }),
  });
  if (!Array.isArray(data.results))
    throw new Error("Unexpected Tavily response");
  const summary: SearchSummary = {
    query,
    keyword,
    country,
    industry,
    format,
    credits:
      Number.isInteger(data.usage?.credits) && data.usage.credits >= 0
        ? data.usage.credits
        : 1,
    credits_measured:
      Number.isInteger(data.usage?.credits) && data.usage.credits >= 0,
    returned: data.results.length,
    excluded: 0,
    invalid: 0,
    duplicates: 0,
    candidates: 0,
  };
  const found = new Map<string, Candidate>();
  for (const row of data.results.slice(0, 20)) {
    if (typeof row?.url !== "string") {
      summary.invalid++;
      continue;
    }
    try {
      const domain = normalizeDomain(row.url);
      if (exclusions.some((d) => domain === d || domain.endsWith(`.${d}`))) {
        summary.excluded++;
        continue;
      }
      if (found.has(domain)) {
        summary.duplicates++;
        continue;
      }
      // A merchant's blog can be a useful search hit. The worker verifies the
      // domain's homepage, so publishers do not bypass Shopify/activity checks.
      found.set(domain, {
        domain,
        name: typeof row.title === "string" ? row.title : domain,
        country: null,
        country_evidence: null,
        industry: "Unknown",
        source_url: row.url,
        source_provider: "tavily",
        priority: storefrontPriority(
          row.url,
          typeof row.title === "string" ? row.title : "",
          typeof row.content === "string" ? row.content : "",
          typeof row.score === "number" ? row.score : 0,
        ),
        search_country: country,
        search_industry: industry,
      });
    } catch {
      summary.invalid++;
    }
  }
  const candidates = [...found.values()].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );
  summary.candidates = candidates.length;
  return {
    candidates,
    summary,
    nextCursor: JSON.stringify({ v: 3, step: step + 1 }),
  };
}

export type { PsiSample } from "../../shared/types.js";
export async function pageSpeed(
  url: string,
  strategy: "mobile" | "desktop",
  sample: number,
  charge: Charge,
): Promise<PsiSample> {
  if (!process.env.PAGESPEED_API_KEY)
    throw new Error("PAGESPEED_API_KEY is required for live audits.");
  await validateTarget(url);
  const endpoint = new URL(
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
  );
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("key", process.env.PAGESPEED_API_KEY);
  for (const category of [
    "performance",
    "seo",
    "accessibility",
    "best-practices",
  ])
    endpoint.searchParams.append("category", category);
  await charge("pagespeed");
  const data = await providerJson(endpoint.href);
  const lhr = data.lighthouseResult;
  if (!lhr?.categories || lhr.runtimeError)
    throw new Error(
      `PageSpeed could not audit this page${lhr?.runtimeError?.code ? `: ${lhr.runtimeError.code}` : ""}`,
    );
  const scores: Record<string, number | null> = {};
  for (const key of ["performance", "seo", "accessibility", "best-practices"]) {
    const raw = lhr.categories[key]?.score;
    scores[key] = typeof raw === "number" ? Math.round(raw * 100) : null;
  }
  const page = data.loadingExperience?.metrics;
  const origin = data.originLoadingExperience?.metrics;
  const metrics =
    page && Object.keys(page).length
      ? page
      : origin && Object.keys(origin).length
        ? origin
        : null;
  return {
    url: lhr.finalDisplayedUrl || lhr.finalUrl || url,
    strategy,
    sample,
    tested_at: lhr.fetchTime || new Date().toISOString(),
    scores,
    environment: {
      lighthouse_version: lhr.lighthouseVersion ?? null,
      form_factor: lhr.configSettings?.formFactor ?? null,
      throttling_method: lhr.configSettings?.throttlingMethod ?? null,
    },
    diagnostics: lhr.audits ?? {},
    field_data: {
      available: !!metrics,
      scope: metrics === page ? "page" : metrics ? "origin" : "unavailable",
      metrics: metrics ?? {},
    },
  };
}
