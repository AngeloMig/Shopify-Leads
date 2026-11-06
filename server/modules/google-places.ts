// Google Places API (New). Every call goes through `charge` first, so it
// counts against the workspace budget before any request is sent.
import { providerJson } from "../lib/network.js";
import {
  placesFields,
  readListing,
  type PlaceListing,
  type SearchHit,
} from "../../shared/local-business.js";
import type { Country } from "../../shared/types.js";

const base = "https://places.googleapis.com/v1";
export const placesConfigured = () => !!process.env.GOOGLE_PLACES_API_KEY;
function key() {
  const k = process.env.GOOGLE_PLACES_API_KEY;
  if (!k)
    throw new Error(
      "GOOGLE_PLACES_API_KEY is not configured. Create a Google Maps Platform key with Places API (New) enabled.",
    );
  return k;
}

/** One page of Text Search: up to 20 places for "<trade> in <city>". */
export async function searchPlaces(
  textQuery: string,
  country: Country,
  pageSize: number,
  charge: () => Promise<void>,
) {
  const apiKey = key();
  await charge();
  const data = await providerJson(`${base}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": placesFields.search.join(","),
    },
    body: JSON.stringify({
      textQuery,
      pageSize: Math.min(20, Math.max(1, pageSize)),
      regionCode: country,
      languageCode: "en",
    }),
  });
  return Array.isArray(data.places) ? data.places : [];
}

/** A listing's details as Google has them now; nothing here is stored. */
export async function placeListing(
  placeId: string,
  level: "list" | "detail",
): Promise<PlaceListing | null> {
  const data = await providerJson(
    `${base}/places/${encodeURIComponent(placeId)}?languageCode=en`,
    {
      headers: {
        "X-Goog-Api-Key": key(),
        "X-Goog-FieldMask": placesFields[level].join(","),
      },
    },
  );
  return readListing(data, level === "detail");
}

/** The web search behind the website check, on whichever provider is set up. */
export function websiteSearchProvider(): "tavily" | "brave" | null {
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (
    process.env.BRAVE_SEARCH_API_KEY &&
    process.env.BRAVE_STORAGE_ALLOWED === "true"
  )
    return "brave";
  return null;
}
export async function searchWeb(
  provider: "tavily" | "brave",
  query: string,
  country: Country,
): Promise<SearchHit[]> {
  if (provider === "tavily") {
    const data = await providerJson("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        topic: "general",
        country: {
          US: "united states",
          GB: "united kingdom",
          CA: "canada",
          AU: "australia",
        }[country],
        search_depth: "basic",
        auto_parameters: false,
        max_results: 10,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
    });
    return Array.isArray(data.results) ? data.results : [];
  }
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("country", country);
  url.searchParams.set("count", "10");
  const data = await providerJson(url.href, {
    headers: { "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY! },
  });
  return Array.isArray(data.web?.results) ? data.web.results : [];
}
