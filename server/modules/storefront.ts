import type { ActivityEmitter } from "../lib/job-activity.js";
import { CrawlSession, normalizeDomain } from "../lib/network.js";
import { inspectHtml } from "./html-audit.js";
import {
  catalogPageSize,
  daysSince,
  evaluateFit,
  summarizeCatalog,
} from "../../shared/catalog.js";
import { outsideFitPrefix } from "../../shared/discovery-search.js";
import type { Country, DiscoverySettings } from "../../shared/types.js";

const recentCatalogDays = 180;
/** Shopify's public product feed. Private or missing feeds simply stay unknown. */
async function readCatalog(
  crawl: Pick<CrawlSession, "fetch">,
  homeUrl: string,
) {
  const url = `${new URL(homeUrl).origin}/products.json?limit=${catalogPageSize}`;
  try {
    const response = await crawl.fetch(url, { maxBytes: 6_000_000 });
    if (
      response.status !== 200 ||
      !response.headers["content-type"]?.includes("json")
    )
      return null;
    return summarizeCatalog(JSON.parse(response.body.toString()), url);
  } catch {
    return null;
  }
}

/** Verify the live site before spending PageSpeed quota or accepting a search hit. */
export async function inspectStorefront(
  domain: string,
  config: DiscoverySettings,
  crawl: Pick<CrawlSession, "fetch">,
  fallback: { country: Country | null; country_evidence: string | null },
  checkpoint: () => Promise<void> = async () => {},
  emit?: ActivityEmitter,
) {
  const origin = `https://${normalizeDomain(domain)}/`;
  const task = (
    key: string,
    name: string,
    state: "starting" | "waiting" | "completed" | "failed",
    message: string,
    url = origin,
    facts = {},
  ) =>
    emit?.("verify", state === "completed" ? "note" : "started", message, {
      url,
      facts,
      task: { key: `${normalizeDomain(domain)}:${key}`, name, state },
    });
  await checkpoint();
  await task(
    "connect",
    "Connect to storefront",
    "starting",
    `Connecting to ${normalizeDomain(domain)}`,
  );
  await task(
    "connect",
    "Connect to storefront",
    "waiting",
    "Waiting for the storefront response",
  );
  let home;
  try {
    home = await crawl.fetch(`https://${normalizeDomain(domain)}`);
  } catch (error) {
    await checkpoint();
    await task(
      "connect",
      "Connect to storefront",
      "failed",
      error instanceof Error ? error.message : "Storefront connection failed",
    );
    throw error;
  }
  await checkpoint();
  await task(
    "connect",
    "Connect to storefront",
    "completed",
    "Storefront response received",
    home.url,
    { status_code: home.status, redirected: home.url !== origin },
  );
  await task(
    "identify",
    "Identify storefront",
    "starting",
    "Checking the response and public Shopify evidence",
    home.url,
  );
  const invalidResponse =
    home.status >= 400
      ? `Storefront returned HTTP ${home.status}`
      : !home.headers["content-type"]?.includes("text/html")
        ? "Storefront did not return HTML"
        : null;
  if (invalidResponse) {
    await task(
      "identify",
      "Identify storefront",
      "failed",
      invalidResponse,
      home.url,
    );
    throw new Error(invalidResponse);
  }
  const homepage = {
    ...inspectHtml(home.body.toString(), home.url),
    http_status: home.status,
  };
  // Only stores already showing Shopify evidence get this extra request.
  await checkpoint();
  const catalog = homepage.shopify.length
    ? await readCatalog(crawl, home.url)
    : null;
  // A real product feed is Shopify evidence that homepage markup can lack.
  const verified = homepage.shopify.length + (catalog ? 1 : 0) >= 2;
  const catalogAge = daysSince(catalog?.newest_published_at);
  const activity = Math.min(
    100,
    25 +
      (homepage.activity.products || catalog?.product_count ? 40 : 0) +
      (homepage.activity.cart ? 20 : 0) +
      (catalogAge !== null && catalogAge <= recentCatalogDays ? 15 : 0),
  );
  const fit = evaluateFit(catalog, config.ideal_client);
  await task(
    "identify",
    "Identify storefront",
    "completed",
    verified
      ? "Shopify storefront identified"
      : "Insufficient Shopify evidence",
    home.url,
    {
      shopify: verified,
      activity,
      ...(catalog ? { products: catalog.product_count } : {}),
    },
  );
  let country = homepage.country ?? fallback.country;
  let country_evidence = homepage.country_evidence ?? fallback.country_evidence;
  // Search localization is never country evidence. Look for the same business's
  // explicit structured address on at most two linked contact/about pages.
  if (verified && activity >= 50 && !country) {
    const pages = [
      ...new Set(
        [
          homepage.contact_url,
          ...homepage.links.filter((url) =>
            /\/(?:pages\/)?(?:about|contact)(?:[-/]|$)/i.test(
              new URL(url).pathname,
            ),
          ),
        ].filter((url): url is string => !!url),
      ),
    ].slice(0, 2);
    for (const url of pages) {
      await checkpoint();
      await task(
        `country:${url}`,
        "Check business country",
        "waiting",
        "Reading a linked page for a business address",
        url,
      );
      let response;
      try {
        response = await crawl.fetch(url);
      } catch {
        await emit?.(
          "verify",
          "skipped",
          "Optional country evidence page could not be read",
          {
            url,
            task: {
              key: `${normalizeDomain(domain)}:country:${url}`,
              name: "Check business country",
              state: "skipped",
            },
          },
        );
        continue;
      } // Unavailable optional evidence does not invent a country.
      await task(
        `country:${url}`,
        "Check business country",
        "completed",
        "Country evidence response received",
        response.url,
        { status_code: response.status },
      );
      if (
        response.status >= 400 ||
        !response.headers["content-type"]?.includes("text/html")
      )
        continue;
      const page = inspectHtml(
        response.body.toString(),
        response.url,
        "country-verification",
      );
      if (page.country) {
        country = page.country;
        country_evidence = page.country_evidence;
        break;
      }
    }
  }
  return {
    home,
    homepage,
    verified,
    activity,
    country,
    country_evidence,
    catalog,
    fit,
    /** Discovery sets these aside before paying for PageSpeed; requested audits still run. */
    fitReason:
      fit.status === "outside"
        ? `${outsideFitPrefix}: ${fit.reasons.join("; ")}`
        : null,
    reason: !verified
      ? "Shopify evidence insufficient"
      : activity < 50
        ? "Activity evidence insufficient"
        : !country || !config.countries.includes(country)
          ? "Target country unverified or excluded"
          : null,
  };
}
