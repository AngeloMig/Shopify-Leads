// The web search behind the "no website" check, on whichever search
// provider the workspace has set up.
import { providerJson } from "../lib/network.js";
import { countryNames, type Country } from "../../shared/types.js";
import type { SearchHit } from "../../shared/local-business.js";

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
        country: countryNames[country].toLowerCase(),
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
