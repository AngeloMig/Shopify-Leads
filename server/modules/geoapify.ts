// Geoapify (OpenStreetMap data). The free plan needs no card: 3,000 credits
// a day, one per geocode or details lookup and one per 20 places returned.
// Every call goes through `charge` first, so it counts against the
// workspace budget before any request is sent.
import { JobError } from "../lib/job-errors.js";
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
// Geoapify says what was wrong with a request; keep that in the job's error.
async function get(path: string, params: Record<string, string>) {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apiKey", key());
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason =
      typeof body?.message === "string"
        ? `: ${body.message.slice(0, 200)}`
        : "";
    throw new JobError(
      `Geoapify request failed (${response.status})${reason}`,
      [401, 403].includes(response.status)
        ? "credentials"
        : response.status === 429
          ? "rate_limit"
          : response.status >= 500
            ? "temporary"
            : "permanent",
      "geoapify",
    );
  }
  return body;
}

/**
 * The city's Geoapify place ID, which bounds the places search to it. The
 * city is looked for in the selected countries only; "Perth, WA" or "Perth,
 * Australia" picks one when two countries have the name.
 */
export async function findCity(
  city: string,
  countries: Country[],
  charge: () => Promise<void>,
) {
  key();
  await charge();
  const data = await get("/v1/geocode/search", {
    text: city,
    type: "city",
    filter: `countrycode:${countries.map((c) => c.toLowerCase()).join(",")}`,
    limit: "1",
    format: "json",
    lang: "en",
  });
  const hit = Array.isArray(data.results) ? data.results[0] : null;
  const country = String(hit?.country_code ?? "").toUpperCase() as Country;
  return typeof hit?.place_id === "string" && countries.includes(country)
    ? {
        filter: `place:${hit.place_id as string}`,
        label: String(hit.formatted ?? city),
        country,
      }
    : null;
}

/** Places matching the filter (a city's boundary or a whole country). */
export async function searchPlaces(
  filter: string,
  categories: string[],
  limit: number,
  charge: () => Promise<void>,
): Promise<GeoapifyPlace[]> {
  key();
  await charge();
  const data = await get("/v2/places", {
    categories: categories.join(","),
    filter,
    limit: String(Math.min(500, Math.max(1, limit))),
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
