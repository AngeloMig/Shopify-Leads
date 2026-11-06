// A local search: for each place (a city, or a whole country when no cities
// are given), list the chosen trades' businesses, keep those with no website,
// and check each with one web search. Listing details come from
// OpenStreetMap through Geoapify and are stored with the lead; Scout adds
// the website check and any social pages it finds.
import { db, checked, now } from "../lib/db.js";
import type { ActivityEmitter } from "../lib/job-activity.js";
import type { Charge } from "./providers.js";
import {
  biggestCities,
  broadCategories,
  inTrade,
  localTrade,
  readWebsiteSearch,
  type GeoapifyPlace,
  type LocalTrade,
  type SocialLink,
} from "../../shared/local-business.js";
import type { Country } from "../../shared/types.js";
import { findCity, placeDetails, searchPlaces } from "./geoapify.js";
import { searchWeb, websiteSearchProvider } from "./web-check.js";

export type LocalSearchConfig = {
  name: string;
  provider: "geoapify";
  search_id: string;
  trades: string[];
  cities: string[];
  countries: Country[];
  per_city: number;
  daily_api_budget: number;
};
export type LocalFunnel = {
  listed: number;
  chains: number;
  in_trade: number;
  listing_has_site: number;
  already_saved: number;
  checked: number;
  site_found: number;
  saved: number;
};
type Area = { filter: string; label: string; country: Country };

const merge = (a: SocialLink[], b: SocialLink[]) => [
  ...a,
  ...b.filter((s) => !a.some((x) => x.url === s.url)),
];

/**
 * Sorts one area's places into the chosen trades, at most `perTrade` each.
 * A business goes to the first trade it belongs to, so it is saved once;
 * trades with a category of their own claim their businesses first.
 */
export function assignTrades(
  places: GeoapifyPlace[],
  trades: LocalTrade[],
  perTrade: number,
) {
  const taken = new Set<string>();
  const count = new Map<string, number>();
  const out: { trade: LocalTrade; place: GeoapifyPlace }[] = [];
  const order = [...trades].sort(
    (a, b) => Number(!a.categories.length) - Number(!b.categories.length),
  );
  for (const trade of order)
    for (const place of places) {
      if ((count.get(trade.id) ?? 0) >= perTrade) break;
      if (taken.has(place.place_id) || !inTrade(trade, place)) continue;
      taken.add(place.place_id);
      count.set(trade.id, (count.get(trade.id) ?? 0) + 1);
      out.push({ trade, place });
    }
  return out;
}

export async function localDiscovery(
  org: string,
  config: LocalSearchConfig,
  charge: Charge,
  outcome: (message: string, details: Record<string, unknown>) => Promise<void>,
  progress: (n: number) => Promise<void>,
  emit: ActivityEmitter,
) {
  const trades = config.trades
    .map(localTrade)
    .filter((t): t is LocalTrade => !!t);
  if (!trades.length) throw new Error("No known trade in this search");
  const web = websiteSearchProvider();
  const geoapify = () => charge("geoapify");
  const funnel: LocalFunnel = {
    listed: 0,
    chains: 0,
    in_trade: 0,
    listing_has_site: 0,
    already_saved: 0,
    checked: 0,
    site_found: 0,
    saved: 0,
  };
  const own = [...new Set(trades.flatMap((t) => t.categories))];
  const broad = trades.some((t) => t.broad);
  // With no cities, each country's biggest cities stand in for the country:
  // Geoapify can't search a whole country at once.
  const wheres = config.cities.length
    ? config.cities.map((city) => ({ city, countries: config.countries }))
    : config.countries.flatMap((c) =>
        biggestCities[c].map((city) => ({ city, countries: [c] })),
      );
  for (const [i, where] of wheres.entries()) {
    const task = { key: `area:${i + 1}`, name: `Search ${where.city}` };
    await emit("search", "started", `Finding ${where.city} on the map`, {
      task: { ...task, state: "running" },
    });
    const area: Area | null = await findCity(
      where.city,
      where.countries,
      geoapify,
    );
    if (!area) {
      await emit(
        "search",
        "skipped",
        `Couldn't find ${where.city} in the chosen countries`,
        { task: { ...task, state: "skipped" } },
      );
      continue;
    }
    // One request for the trades with their own categories, one shared by
    // the name-matched trades, however many trades were chosen.
    const found: GeoapifyPlace[] = [];
    if (own.length)
      found.push(
        ...(await searchPlaces(
          area.filter,
          own,
          config.per_city * trades.length,
          geoapify,
        )),
      );
    if (broad)
      found.push(
        ...(await searchPlaces(area.filter, broadCategories, 500, geoapify)),
      );
    // Branches of a brand or franchise use the brand's website: not leads.
    const onMap = [...new Map(found.map((p) => [p.place_id, p])).values()];
    const unique = onMap.filter((p) => !p.chain);
    const matching = assignTrades(unique, trades, config.per_city);
    funnel.listed += onMap.length;
    funnel.chains += onMap.length - unique.length;
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
                  matching.map((m) => m.place.place_id),
                ),
            )
          ).map((r: { place_id: string }) => r.place_id)
        : [],
    );
    const fresh = matching.filter((m) => !known.has(m.place.place_id));
    funnel.already_saved += matching.length - fresh.length;
    await emit(
      "search",
      "completed",
      `${matching.length} businesses in ${area.label} across ${trades.length} trades, ${fresh.length} new`,
      {
        task: { ...task, state: "completed" },
        facts: {
          listed: onMap.length,
          in_trade: matching.length,
          new: fresh.length,
        },
      },
    );
    for (const { trade, place: listed } of fresh) {
      // A list result may leave out contact fields; the details lookup has them.
      const place: GeoapifyPlace = listed.has_contact_fields
        ? listed
        : ((await placeDetails(listed.place_id, geoapify)) ?? listed);
      if (place.website) {
        funnel.listing_has_site++;
        continue;
      }
      const city = place.city ?? listed.city ?? where.city;
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
          await searchWeb(web, query, area.country),
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
              city: city.slice(0, 200),
              country: place.country ?? area.country,
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
    await progress(Math.round(((i + 1) / wheres.length) * 95));
    await outcome("running", { funnel });
  }
  const noSite = funnel.saved - funnel.site_found;
  await emit(
    "queue",
    "completed",
    `Saved ${funnel.saved} local businesses; ${noSite} with no website found`,
    { facts: { ...funnel } },
  );
  await outcome(
    web
      ? `Saved ${noSite} businesses with no website found`
      : `Saved ${funnel.saved} listings with no website (no web search set up for the check)`,
    { funnel },
  );
}
