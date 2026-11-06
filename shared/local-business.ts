// Local businesses without a website: what Scout stores, what it fetches live
// from Google Places, and the website check that decides "no website".
import type { Country } from "./types.js";

export type WebsiteCheck = "no_site_found" | "site_found" | "not_checked";
export type LocalStage = "new" | "contacted" | "won" | "lost";
export const localStages: LocalStage[] = ["new", "contacted", "won", "lost"];
export type SocialNetwork =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "tiktok"
  | "x"
  | "youtube";
export type SocialLink = { network: SocialNetwork; url: string };

/** A listing's details, fetched from Google Places when someone looks. */
export type PlaceListing = {
  name: string;
  address: string | null;
  maps_url: string | null;
  status: string | null;
  type: string | null;
  phone?: string | null;
  rating?: number | null;
  reviews?: number | null;
  hours?: string[];
  website?: string | null;
};

/** Scout's own research on one business. Google content lives in `listing`. */
export type LocalBusiness = {
  id: string;
  place_id: string;
  trade: string;
  city: string;
  country: Country;
  website_check: WebsiteCheck;
  found_site: string | null;
  check_query: string | null;
  social_links: SocialLink[];
  stage: LocalStage;
  notes: string;
  suppressed: boolean;
  found_at: string;
  listing: PlaceListing | null;
  listing_error?: "not_configured" | "budget" | "unavailable";
};

export type LocalSearch = {
  id: string;
  trade: string;
  cities: string[];
  country: Country;
  per_city: number;
  created_at: string;
  saved?: number;
  no_site?: number;
};

export const localTradeSuggestions = [
  "Construction company",
  "General contractor",
  "Roofing contractor",
  "Plumber",
  "Electrician",
  "Landscaper",
  "Painter",
  "Concrete contractor",
  "HVAC contractor",
  "Fence contractor",
];

/** The Text Search phrase for one trade in one city. */
export const localQuery = (trade: string, city: string) =>
  `${trade.trim()} in ${city.trim()}`;

// Field masks decide the Places billing tier: search needs the website field
// to tell who has none; the list view needs only Pro fields; the open lead
// adds phone, rating and hours.
export const placesFields = {
  search: [
    "places.id",
    "places.displayName",
    "places.websiteUri",
    "places.businessStatus",
    "nextPageToken",
  ],
  list: [
    "id",
    "displayName",
    "formattedAddress",
    "googleMapsUri",
    "businessStatus",
    "primaryTypeDisplayName",
  ],
  detail: [
    "id",
    "displayName",
    "formattedAddress",
    "googleMapsUri",
    "businessStatus",
    "primaryTypeDisplayName",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
    "rating",
    "userRatingCount",
    "regularOpeningHours.weekdayDescriptions",
    "websiteUri",
  ],
};

type PlaceResource = {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  googleMapsUri?: unknown;
  businessStatus?: unknown;
  primaryTypeDisplayName?: { text?: unknown };
  nationalPhoneNumber?: unknown;
  internationalPhoneNumber?: unknown;
  rating?: unknown;
  userRatingCount?: unknown;
  regularOpeningHours?: { weekdayDescriptions?: unknown };
  websiteUri?: unknown;
};
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** A Places resource as a listing, keeping only fields that came back. */
export function readListing(place: PlaceResource, detail = false) {
  const name = text(place.displayName?.text);
  if (!name) return null;
  const listing: PlaceListing = {
    name,
    address: text(place.formattedAddress),
    maps_url: text(place.googleMapsUri),
    status: text(place.businessStatus),
    type: text(place.primaryTypeDisplayName?.text),
  };
  if (!detail) return listing;
  const hours = place.regularOpeningHours?.weekdayDescriptions;
  return {
    ...listing,
    phone:
      text(place.nationalPhoneNumber) ?? text(place.internationalPhoneNumber),
    rating: num(place.rating),
    reviews: num(place.userRatingCount),
    hours: Array.isArray(hours)
      ? hours.filter((h): h is string => typeof h === "string").slice(0, 7)
      : [],
    website: text(place.websiteUri),
  };
}

/** Search results worth a website check: open and linking no website. */
export function withoutWebsite(places: PlaceResource[]) {
  return places.flatMap((p) => {
    const id = text(p.id);
    const name = text(p.displayName?.text);
    if (!id || !name || text(p.websiteUri)) return [];
    if (p.businessStatus && p.businessStatus !== "OPERATIONAL") return [];
    return [{ place_id: id, name }];
  });
}

// Words that name the trade or the company form, not the business itself.
const generic = new Set(
  `and the of llc inc ltd co company corp corporation pty limited group services service solutions
  construction constructions builders builder building build contractors contractor contracting
  general roofing roofers roof plumbing plumbers plumber electric electrical electricians electrician
  landscaping landscape landscapers painting painters painter concrete hvac heating cooling air
  fence fencing remodeling remodelling renovations renovation home homes property properties
  repair repairs maintenance handyman custom quality pro pros professional local best`
    .split(/\s+/)
    .filter(Boolean),
);
/** The words that make a business name its own (Harbor in "Harbor Roofing LLC"). */
export function nameTokens(name: string) {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  const distinct = words.filter((w) => !generic.has(w) && w.length >= 4);
  return { words, distinct };
}

// Profiles and listings that say nothing about whether a business has a site
// of its own; social networks are read separately as social links.
const listingSites = [
  "google.com",
  "goo.gl",
  "yelp.com",
  "yelp.co.uk",
  "yellowpages.com",
  "yellowpages.ca",
  "yellowpages.com.au",
  "yell.com",
  "bbb.org",
  "angi.com",
  "angieslist.com",
  "homeadvisor.com",
  "houzz.com",
  "houzz.co.uk",
  "thumbtack.com",
  "nextdoor.com",
  "mapquest.com",
  "manta.com",
  "chamberofcommerce.com",
  "porch.com",
  "buildzoom.com",
  "bark.com",
  "checkatrade.com",
  "ratedpeople.com",
  "mybuilder.com",
  "trustpilot.com",
  "opencorporates.com",
  "dnb.com",
  "zoominfo.com",
  "bizapedia.com",
  "buzzfile.com",
  "indeed.com",
  "glassdoor.com",
  "wikipedia.org",
  "hipages.com.au",
  "truelocal.com.au",
  "homestars.com",
  "411.ca",
  "cylex.us.com",
  "birdeye.com",
  "alignable.com",
  "superpages.com",
  "dexknows.com",
  "merchantcircle.com",
  "brownbook.net",
  "findhelp.org",
  "apple.com",
  "bing.com",
  "loopnet.com",
  "zillow.com",
];
const socialHosts: Record<string, SocialNetwork> = {
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "instagram.com": "instagram",
  "linkedin.com": "linkedin",
  "tiktok.com": "tiktok",
  "x.com": "x",
  "twitter.com": "x",
  "youtube.com": "youtube",
};
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  } catch {
    return null;
  }
};
const within = (host: string, site: string) =>
  host === site || host.endsWith(`.${site}`);

export type SearchHit = { url: string; title?: string | null };
export type WebsiteVerdict = {
  website_check: Exclude<WebsiteCheck, "not_checked">;
  found_site: string | null;
  social_links: SocialLink[];
};

/**
 * Reads a web search for "<business name>" <city>. A result counts as the
 * business's own site when its domain carries a word that is distinctly the
 * business's (not the trade) and the page title names it too. When unsure,
 * it leans towards "site found", so a lead marked no-website is a strong one.
 * Social pages that name the business are kept as contact routes.
 */
export function readWebsiteSearch(name: string, hits: SearchHit[]) {
  const { words, distinct } = nameTokens(name);
  const marks = distinct.length ? distinct : words;
  const social: SocialLink[] = [];
  let found: string | null = null;
  for (const hit of hits.slice(0, 20)) {
    const host = hostOf(hit.url);
    if (!host) continue;
    const title = (hit.title ?? "").toLowerCase();
    const path = (() => {
      try {
        return decodeURIComponent(new URL(hit.url).pathname).toLowerCase();
      } catch {
        return "";
      }
    })();
    const network = Object.entries(socialHosts).find(([h]) =>
      within(host, h),
    )?.[1];
    if (network) {
      const names = marks.some(
        (m) => title.includes(m) || path.replace(/[^a-z0-9]/g, "").includes(m),
      );
      if (
        names &&
        social.length < 6 &&
        !social.some((s) => s.url === hit.url) &&
        !/\/(search|hashtag|explore|public|directory)\b/.test(path)
      )
        social.push({ network, url: hit.url });
      continue;
    }
    if (listingSites.some((s) => within(host, s))) continue;
    const label = host
      .split(".")
      .slice(0, -1)
      .join("")
      .replace(/[^a-z0-9]/g, "");
    const owns = distinct.length
      ? distinct.some((t) => label.includes(t) && title.includes(t))
      : words.length > 0 && words.every((t) => label.includes(t));
    if (owns && !found) found = host;
  }
  const verdict: WebsiteVerdict = {
    website_check: found ? "site_found" : "no_site_found",
    found_site: found,
    social_links: social,
  };
  return verdict;
}

export const websiteCheckLabel: Record<WebsiteCheck, string> = {
  no_site_found: "No website found",
  site_found: "Has a website",
  not_checked: "Listing has no website",
};
export const socialLabel: Record<SocialNetwork, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
};
