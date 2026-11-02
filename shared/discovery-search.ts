import { countryNames, type Country, type DiscoverySettings } from "./types.js";
import { searchKeywords } from "./discovery-keywords.js";

export const searchFormats = [
  "online-shop",
  "independent-shopify",
  "shopify-footer",
  "product-store",
  "regional-store",
  "local-brand",
] as const;
export type QueryOutcome = {
  keyword: string;
  country: string;
  industry: string;
  format?: string;
  credits: number;
  completed_audits: number;
  suitable_contacts: number;
  queued: number;
  created_at?: string;
  won_leads?: number;
  not_fit_leads?: number;
};
/** Clients won outweigh everything; a store marked "not a fit" counts against its query. */
export const queryYield = (g: {
  completed_audits: number;
  suitable_contacts: number;
  credits: number;
  won_leads?: number;
  not_fit_leads?: number;
}) =>
  Math.max(
    0,
    g.completed_audits +
      2 * g.suitable_contacts +
      10 * (g.won_leads ?? 0) -
      2 * (g.not_fit_leads ?? 0),
  ) / Math.max(1, g.credits);
const regions: Record<Country, string[]> = {
  AU: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide"],
  US: ["California", "New York", "Texas", "Florida", "Oregon"],
  GB: ["London", "Manchester", "Bristol", "Edinburgh", "Leeds"],
  CA: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa"],
};
export function queryPerformance(rows: QueryOutcome[]) {
  const groups = new Map<
    string,
    QueryOutcome & {
      searches: number;
      credits: number;
      completed_audits: number;
      suitable_contacts: number;
      won_leads: number;
      not_fit_leads: number;
    }
  >();
  for (const row of rows) {
    const key = JSON.stringify([
      row.country,
      row.industry,
      row.keyword,
      row.format ?? "legacy",
    ]);
    const group = groups.get(key) ?? {
      ...row,
      format: row.format ?? "legacy",
      searches: 0,
      credits: 0,
      completed_audits: 0,
      suitable_contacts: 0,
      queued: 0,
      won_leads: 0,
      not_fit_leads: 0,
    };
    group.searches++;
    group.credits += Number(row.credits) || 0;
    group.completed_audits += Number(row.completed_audits) || 0;
    group.suitable_contacts += Number(row.suitable_contacts) || 0;
    group.queued += Number(row.queued) || 0;
    group.won_leads += Number(row.won_leads) || 0;
    group.not_fit_leads += Number(row.not_fit_leads) || 0;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      yield: queryYield(g),
    }))
    .sort(
      (a, b) =>
        b.yield - a.yield ||
        b.completed_audits - a.completed_audits ||
        a.keyword.localeCompare(b.keyword),
    );
}
export function planSearch(
  config: DiscoverySettings,
  step: number,
  outcomes: QueryOutcome[] = [],
) {
  const pairs = (
    config.industries.length ? config.industries : ["Other"]
  ).flatMap((industry) =>
    config.countries.map((country) => ({
      industry,
      country,
      words: searchKeywords(config, industry),
    })),
  );
  const choices = Array.from(
    { length: Math.max(0, ...pairs.map((p) => p.words.length)) },
    (_, index) =>
      pairs.flatMap((p) =>
        p.words[index]
          ? [
              {
                industry: p.industry,
                country: p.country,
                keyword: p.words[index],
              },
            ]
          : [],
      ),
  ).flat();
  if (!choices.length) throw new Error("Select at least one target country.");
  const position = step % choices.length,
    cycle = Math.floor(step / choices.length);
  let choice = choices[position],
    format = searchFormats[(position + cycle) % searchFormats.length],
    mode = "explore";
  if (config.adaptive_queries !== false && step % 4 === 3) {
    const best = queryPerformance(outcomes).find(
      (g) =>
        g.completed_audits > 0 &&
        searchFormats.includes(g.format as typeof format) &&
        choices.some(
          (c) =>
            c.country === g.country &&
            c.industry === g.industry &&
            c.keyword === g.keyword,
        ),
    );
    if (best) {
      choice = choices.find(
        (c) =>
          c.country === best.country &&
          c.industry === best.industry &&
          c.keyword === best.keyword,
      )!;
      format = best.format as typeof format;
      mode = "productive";
    }
  }
  const { keyword, country } = choice,
    location = countryNames[country];
  const region = regions[country][(cycle + position) % regions[country].length];
  const query = {
    "online-shop": `${keyword} online shop ${location}`,
    "independent-shopify": `${keyword} independent store ${location} Shopify`,
    "shopify-footer": `${keyword} ${location} "powered by Shopify"`,
    "product-store": `buy ${keyword} ${location} products collection`,
    "regional-store": `${keyword} independent shop ${region} ${location}`,
    "local-brand": `${keyword} local brand online store ${location}`,
  }[format].slice(0, 400);
  return { ...choice, format, query, mode };
}
export function storefrontPriority(
  url: string,
  title: string,
  content: string,
  score = 0,
) {
  const path = new URL(url).pathname,
    text = `${title} ${content}`.slice(0, 3000).toLowerCase();
  return (
    Math.round(Math.max(0, Math.min(1, score)) * 10) +
    (/\/(products|collections|shop)(\/|$)/i.test(path) ? 30 : 0) +
    (/shop|shipping|add to cart|our products|buy online/.test(text) ? 15 : 0) -
    (/best \d|top \d|roundup|directory|marketing agency|web design agency/.test(
      text,
    )
      ? 25
      : 0)
  );
}
export const outsideFitPrefix = "Outside ideal client";
export function rejectionPolicy(reason: string, now = Date.now()) {
  // Checked first and short-lived: loosening a campaign should bring these back soon.
  if (reason.startsWith(outsideFitPrefix))
    return {
      code: "outside_fit",
      global: false,
      retryAt: new Date(now + 7 * 86400000).toISOString(),
    };
  const temporary =
    /429|5\d\d|timeout|timed out|unavailable|fetch failed|DNS|ENOTFOUND/i.test(
      reason,
    );
  const blocked =
    /disallowed by robots|robots.*(401|403)|HTTP (401|403)|crawl delay/i.test(
      reason,
    );
  const country = /country/i.test(reason);
  const code = blocked
    ? "crawl_blocked"
    : temporary
      ? "temporary"
      : country
        ? "country"
        : "not_storefront";
  const days = blocked ? 7 : temporary ? 1 : country ? 14 : 30;
  return {
    code,
    global: !country,
    retryAt: new Date(now + days * 86400000).toISOString(),
  };
}
export function tavilyExclusions(
  manual: string[],
  permanent: string[],
  processed: string[],
) {
  return [
    ...new Set(
      [...manual, ...permanent, ...processed]
        .filter((d) =>
          /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(d),
        )
        .map((d) => d.toLowerCase()),
    ),
  ].slice(0, 150);
}
