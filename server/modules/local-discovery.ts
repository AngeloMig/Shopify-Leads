// A local search: for each city, one Places Text Search for the trade, then a
// web search per listing that links no website. What is saved is the place ID
// and Scout's own check; Google's listing details are never stored.
import { db, checked, now } from "../lib/db.js";
import type { ActivityEmitter } from "../lib/job-activity.js";
import type { Charge } from "./providers.js";
import {
  localQuery,
  readWebsiteSearch,
  withoutWebsite,
} from "../../shared/local-business.js";
import type { Country } from "../../shared/types.js";
import {
  searchPlaces,
  searchWeb,
  websiteSearchProvider,
} from "./google-places.js";

export type LocalSearchConfig = {
  name: string;
  provider: "google_places";
  search_id: string;
  trade: string;
  cities: string[];
  country: Country;
  per_city: number;
  daily_api_budget: number;
};
export type LocalFunnel = {
  listed: number;
  listing_has_site: number;
  already_saved: number;
  checked: number;
  site_found: number;
  saved: number;
};

export async function localDiscovery(
  org: string,
  config: LocalSearchConfig,
  charge: Charge,
  outcome: (message: string, details: Record<string, unknown>) => Promise<void>,
  progress: (n: number) => Promise<void>,
  emit: ActivityEmitter,
) {
  const web = websiteSearchProvider();
  const funnel: LocalFunnel = {
    listed: 0,
    listing_has_site: 0,
    already_saved: 0,
    checked: 0,
    site_found: 0,
    saved: 0,
  };
  for (const [i, city] of config.cities.entries()) {
    const query = localQuery(config.trade, city);
    const task = { key: `places:${i + 1}`, name: `Search: ${query}` };
    await emit("search", "started", `Searching Google Maps for ${query}`, {
      task: { ...task, state: "running" },
      facts: { query, country: config.country },
    });
    const places = await searchPlaces(
      query,
      config.country,
      config.per_city,
      () => charge("google_places"),
    );
    const open = withoutWebsite(places);
    funnel.listed += places.length;
    funnel.listing_has_site += places.length - open.length;
    const known = new Set(
      open.length
        ? (
            await checked(
              db()
                .from("local_businesses")
                .select("place_id")
                .eq("organization_id", org)
                .in(
                  "place_id",
                  open.map((p) => p.place_id),
                ),
            )
          ).map((r: { place_id: string }) => r.place_id)
        : [],
    );
    const fresh = open.filter((p) => !known.has(p.place_id));
    funnel.already_saved += open.length - fresh.length;
    await emit(
      "search",
      "completed",
      `${places.length} listings, ${open.length} with no website linked, ${fresh.length} new`,
      {
        task: { ...task, state: "completed" },
        facts: {
          listings: places.length,
          no_website_linked: open.length,
          new: fresh.length,
        },
      },
    );
    for (const place of fresh) {
      // The name is Google's and only used for this one search query.
      const checkQuery = `"${place.name}" ${city}`;
      let row: Record<string, unknown> = {
        organization_id: org,
        place_id: place.place_id,
        search_id: config.search_id,
        trade: config.trade,
        city,
        country: config.country,
        website_check: "not_checked",
        found_site: null,
        check_query: null,
        social_links: [],
        checked_at: now(),
      };
      if (web) {
        await emit("verify", "started", `Checking the web for ${place.name}`, {
          task: {
            key: `check:${place.place_id}`,
            name: "Website check",
            state: "running",
          },
        });
        await charge(web);
        const verdict = readWebsiteSearch(
          place.name,
          await searchWeb(web, checkQuery, config.country),
        );
        funnel.checked++;
        if (verdict.website_check === "site_found") funnel.site_found++;
        row = { ...row, ...verdict, check_query: checkQuery };
        await emit(
          "verify",
          "completed",
          verdict.found_site
            ? `Found a site that looks like theirs: ${verdict.found_site}`
            : `No website found${verdict.social_links.length ? `; ${verdict.social_links.length} social pages` : ""}`,
          {
            task: {
              key: `check:${place.place_id}`,
              name: "Website check",
              state: "completed",
            },
            facts: { social_pages: verdict.social_links.length },
          },
        );
      }
      // Upsert on the place ID: a business found twice in one run is kept once.
      await checked(
        db()
          .from("local_businesses")
          .upsert(row, {
            onConflict: "organization_id,place_id",
            ignoreDuplicates: true,
          }),
      );
      funnel.saved++;
    }
    await progress(Math.round(((i + 1) / config.cities.length) * 95));
    await outcome("running", { funnel });
  }
  await emit(
    "queue",
    "completed",
    `Saved ${funnel.saved} local businesses; ${funnel.saved - funnel.site_found} with no website found`,
    { facts: { ...funnel } },
  );
  await outcome(
    web
      ? `Saved ${funnel.saved - funnel.site_found} businesses with no website found`
      : `Saved ${funnel.saved} listings with no website linked (no web search set up for the check)`,
    { funnel },
  );
}
