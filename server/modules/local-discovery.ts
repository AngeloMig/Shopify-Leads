// A local search: for each city, find its boundary, list the trade's places
// in it, keep those with no website, and check each with one web search.
// Listing details come from OpenStreetMap through Geoapify and are stored
// with the lead; Scout adds the website check and any social pages it finds.
import { db, checked, now } from "../lib/db.js";
import type { ActivityEmitter } from "../lib/job-activity.js";
import type { Charge } from "./providers.js";
import {
  inTrade,
  localTrade,
  readWebsiteSearch,
  type GeoapifyPlace,
  type SocialLink,
} from "../../shared/local-business.js";
import type { Country } from "../../shared/types.js";
import { findCity, placeDetails, searchPlaces } from "./geoapify.js";
import { searchWeb, websiteSearchProvider } from "./web-check.js";

export type LocalSearchConfig = {
  name: string;
  provider: "geoapify";
  search_id: string;
  trade: string;
  cities: string[];
  country: Country;
  per_city: number;
  daily_api_budget: number;
};
export type LocalFunnel = {
  listed: number;
  in_trade: number;
  listing_has_site: number;
  already_saved: number;
  checked: number;
  site_found: number;
  saved: number;
};

const merge = (a: SocialLink[], b: SocialLink[]) => [
  ...a,
  ...b.filter((s) => !a.some((x) => x.url === s.url)),
];

export async function localDiscovery(
  org: string,
  config: LocalSearchConfig,
  charge: Charge,
  outcome: (message: string, details: Record<string, unknown>) => Promise<void>,
  progress: (n: number) => Promise<void>,
  emit: ActivityEmitter,
) {
  const trade = localTrade(config.trade);
  if (!trade) throw new Error(`Unknown trade: ${config.trade}`);
  const web = websiteSearchProvider();
  const geoapify = () => charge("geoapify");
  const funnel: LocalFunnel = {
    listed: 0,
    in_trade: 0,
    listing_has_site: 0,
    already_saved: 0,
    checked: 0,
    site_found: 0,
    saved: 0,
  };
  for (const [i, city] of config.cities.entries()) {
    const task = { key: `places:${i + 1}`, name: `${trade.label}: ${city}` };
    await emit("search", "started", `Finding ${city} on the map`, {
      task: { ...task, state: "running" },
      facts: { city, country: config.country },
    });
    const area = await findCity(city, config.country, geoapify);
    if (!area) {
      await emit(
        "search",
        "skipped",
        `Couldn't find ${city} in ${config.country}`,
        {
          task: { ...task, state: "skipped" },
        },
      );
      continue;
    }
    // Broad categories are matched by name, so ask for more than will be kept.
    const places = await searchPlaces(
      area.place_id,
      trade.categories,
      trade.match ? 100 : config.per_city,
      geoapify,
    );
    const matching = places
      .filter((p) => inTrade(trade, p))
      .slice(0, config.per_city);
    funnel.listed += places.length;
    funnel.in_trade += matching.length;
    const known = new Set(
      matching.length
        ? (
            await checked(
              db()
                .from("local_businesses")
                .select("place_id")
                .eq("organization_id", org)
                .eq("source", "geoapify")
                .in(
                  "place_id",
                  matching.map((p) => p.place_id),
                ),
            )
          ).map((r: { place_id: string }) => r.place_id)
        : [],
    );
    const fresh = matching.filter((p) => !known.has(p.place_id));
    funnel.already_saved += matching.length - fresh.length;
    await emit(
      "search",
      "completed",
      `${matching.length} ${trade.label.toLowerCase()} listings in ${area.label}, ${fresh.length} new`,
      {
        task: { ...task, state: "completed" },
        facts: {
          listed: places.length,
          in_trade: matching.length,
          new: fresh.length,
        },
      },
    );
    for (const found of fresh) {
      // A list result may leave out contact fields; the details lookup has them.
      const place: GeoapifyPlace = found.has_contact_fields
        ? found
        : ((await placeDetails(found.place_id, geoapify)) ?? found);
      if (place.website) {
        funnel.listing_has_site++;
        continue;
      }
      let check: Record<string, unknown> = {
        website_check: "not_checked",
        found_site: null,
        check_query: null,
        social_links: place.social_links,
      };
      if (web) {
        const query = `"${place.name}" ${city}`;
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
          await searchWeb(web, query, config.country),
        );
        funnel.checked++;
        if (verdict.website_check === "site_found") funnel.site_found++;
        check = {
          ...verdict,
          social_links: merge(place.social_links, verdict.social_links),
          check_query: query,
        };
        await emit(
          "verify",
          "completed",
          verdict.found_site
            ? `Found a site that looks like theirs: ${verdict.found_site}`
            : "No website found",
          {
            task: {
              key: `check:${place.place_id}`,
              name: "Website check",
              state: "completed",
            },
            facts: {
              social_pages: (check.social_links as SocialLink[]).length,
            },
          },
        );
      }
      await checked(
        db()
          .from("local_businesses")
          .upsert(
            {
              organization_id: org,
              source: "geoapify",
              place_id: place.place_id,
              search_id: config.search_id,
              trade: trade.label,
              city,
              country: config.country,
              name: place.name.slice(0, 300),
              address: place.address?.slice(0, 500) ?? null,
              phone: place.phone?.slice(0, 100) ?? null,
              email: place.email?.slice(0, 200) ?? null,
              opening_hours: place.opening_hours?.slice(0, 500) ?? null,
              lat: place.lat,
              lon: place.lon,
              osm_url: place.osm_url,
              ...check,
              checked_at: now(),
            },
            {
              onConflict: "organization_id,source,place_id",
              ignoreDuplicates: true,
            },
          ),
      );
      funnel.saved++;
    }
    await progress(Math.round(((i + 1) / config.cities.length) * 95));
    await outcome("running", { funnel });
  }
  const noSite = funnel.saved - funnel.site_found;
  await emit(
    "queue",
    "completed",
    `Saved ${funnel.saved} local businesses; ${noSite} with no website found`,
    {
      facts: { ...funnel },
    },
  );
  await outcome(
    web
      ? `Saved ${noSite} businesses with no website found`
      : `Saved ${funnel.saved} listings with no website (no web search set up for the check)`,
    { funnel },
  );
}
