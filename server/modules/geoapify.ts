// Geoapify (OpenStreetMap data). The free plan needs no card: 3,000 credits
// a day, one per geocode or details lookup and one per 20 places returned.
// Every call goes through `charge` first, so it counts against the
// workspace budget before any request is sent.
import { providerJson } from "../lib/network.js";
import {
  readGeoapifyPlace,
  type GeoapifyPlace,
} from "../../shared/local-business.js";
import type { Country } from "../../shared/types.js";

const base = "https://api.geoapify.com";
export const geoapifyConfigured = () => !!process.env.GEOAPIFY_API_KEY;
function key() {
  const k = process.env.GEOAPIFY_API_KEY;
  if (!k)
    throw new Error(
      "GEOAPIFY_API_KEY is not configured. Create a free key at myprojects.geoapify.com.",
    );
  return k;
}
const get = (path: string, params: Record<string, string>) => {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apiKey", key());
  return providerJson(url.href);
};

/** The city's Geoapify place ID, which bounds the places search to it. */
export async function findCity(
  city: string,
  country: Country,
  charge: () => Promise<void>,
) {
  key();
  await charge();
  const data = await get("/v1/geocode/search", {
    text: city,
    type: "city",
    filter: `countrycode:${country.toLowerCase()}`,
    limit: "1",
    format: "json",
    lang: "en",
  });
  const hit = Array.isArray(data.results) ? data.results[0] : null;
  return typeof hit?.place_id === "string"
    ? { place_id: hit.place_id as string, label: String(hit.formatted ?? city) }
    : null;
}

/** Places in the city's boundary for the given categories. */
export async function searchPlaces(
  cityPlaceId: string,
  categories: string[],
  limit: number,
  charge: () => Promise<void>,
): Promise<GeoapifyPlace[]> {
  key();
  await charge();
  const data = await get("/v2/places", {
    categories: categories.join(","),
    filter: `place:${cityPlaceId}`,
    limit: String(Math.min(100, Math.max(1, limit))),
    lang: "en",
  });
  const features: unknown[] = Array.isArray(data.features) ? data.features : [];
  return features
    .map((f) => readGeoapifyPlace(f as Parameters<typeof readGeoapifyPlace>[0]))
    .filter((p): p is GeoapifyPlace => !!p);
}

/** One place's full details: website, contact and hours as OSM has them. */
export async function placeDetails(
  placeId: string,
  charge: () => Promise<void>,
) {
  key();
  await charge();
  const data = await get("/v2/place-details", {
    id: placeId,
    features: "details",
    lang: "en",
  });
  const feature = Array.isArray(data.features) ? data.features[0] : null;
  return feature ? readGeoapifyPlace(feature) : null;
}
