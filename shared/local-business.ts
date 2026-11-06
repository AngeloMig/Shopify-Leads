// Local businesses without a website: what Scout stores about them, the
// trades it can search, and the website check that decides "no website".
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

/** One business found on the map, with Scout's own research on it. */
export type LocalBusiness = {
  id: string;
  place_id: string;
  trade: string;
  city: string;
  country: Country;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  opening_hours: string | null;
  lat: number | null;
  lon: number | null;
  osm_url: string | null;
  website_check: WebsiteCheck;
  found_site: string | null;
  check_query: string | null;
  social_links: SocialLink[];
  stage: LocalStage;
  notes: string;
  suppressed: boolean;
  found_at: string;
};

export type LocalSearch = {
  id: string;
  trades: string[];
  cities: string[];
  countries: Country[];
  per_city: number;
  created_at: string;
  /** Businesses this search saved. */
  saved?: number;
};
export const localCountries: Country[] = ["US", "GB", "CA", "AU"];
export const maxSearchTrades = 10;
/**
 * Searched when no cities are given. Geoapify can't search a whole country
 * at once (its Places API takes a map area, and a country's boundary is too
 * big), so "biggest cities" stands in for it.
 */
export const biggestCities: Record<Country, string[]> = {
  US: [
    "New York, NY",
    "Los Angeles, CA",
    "Chicago, IL",
    "Houston, TX",
    "Phoenix, AZ",
  ],
  GB: ["London", "Birmingham", "Manchester", "Glasgow", "Leeds"],
  CA: [
    "Toronto, ON",
    "Montreal, QC",
    "Vancouver, BC",
    "Calgary, AB",
    "Edmonton, AB",
  ],
  AU: [
    "Sydney, NSW",
    "Melbourne, VIC",
    "Brisbane, QLD",
    "Perth, WA",
    "Adelaide, SA",
  ],
};

// What a search can look for. A trade with its own Geoapify category takes
// every business in it. Geoapify has no category for many trades (roofer,
// plumber, construction company...), so those also read its broad company
// and trade categories and keep a business there only when its name or
// OpenStreetMap craft/office tag says the trade.
export type LocalTrade = {
  id: string;
  label: string;
  group: string;
  /** Geoapify categories that belong to the trade outright. */
  categories: string[];
  /** Also search the broad company and trade categories, matched by `match`. */
  broad?: boolean;
  /** Name words or OSM craft/office tags that place a business in the trade. */
  match?: RegExp;
};
export const broadCategories = ["office.company", "commercial.trade"];
const t = (
  group: string,
  id: string,
  label: string,
  categories: string[],
  match?: RegExp,
): LocalTrade => ({ id, label, group, categories, broad: !!match, match });
const build = "Construction and home services",
  auto = "Auto",
  beauty = "Beauty and fitness",
  food = "Food and drink",
  health = "Health and pets",
  other = "Other local services";
const materials = "commercial.houseware_and_hardware.building_materials";
export const localTrades: LocalTrade[] = [
  t(
    build,
    "construction",
    "Construction company",
    [],
    /construct|builder|contractor|contracting|remodel|renovat|construction_company|\bbuilder\b/,
  ),
  t(build, "roofing", "Roofing contractor", [], /roof/),
  t(build, "plumbing", "Plumber", [], /plumb/),
  t(build, "electrician", "Electrician", ["service.electrician"], /electric/),
  t(
    build,
    "hvac",
    "HVAC contractor",
    [],
    /hvac|heating|air ?condition|cooling|furnace/,
  ),
  t(
    build,
    "carpenter",
    "Carpenter",
    ["service.carpenter"],
    /carpent|joiner|cabinet/,
  ),
  t(build, "painting", "Painter and decorator", [], /paint|decorat/),
  t(
    build,
    "concrete",
    "Concrete and paving",
    [],
    /concrete|paving|asphalt|driveway/,
  ),
  t(build, "masonry", "Bricklayer and stonemason", [], /mason|brick|stonework/),
  t(
    build,
    "landscaping",
    "Landscaper",
    ["commercial.garden"],
    /landscap|lawn|garden design|gardener|turf|irrigation/,
  ),
  t(build, "tree_service", "Tree service", [], /\btree|arborist|stump/),
  t(build, "fencing", "Fence and deck builder", [], /fenc|deck/),
  t(
    build,
    "flooring",
    "Flooring and tiling",
    [
      `${materials}.flooring`,
      `${materials}.tiles`,
      "commercial.furniture_and_interior.carpet",
    ],
    /floor|tile|tiling|carpet/,
  ),
  t(
    build,
    "windows",
    "Windows, doors and glass",
    [`${materials}.windows`, `${materials}.doors`, `${materials}.glaziery`],
    /window|glass|glaz|door/,
  ),
  t(
    build,
    "kitchens",
    "Kitchen and bathroom fitter",
    [
      "commercial.furniture_and_interior.kitchen",
      "commercial.furniture_and_interior.bathroom",
    ],
    /kitchen|bathroom/,
  ),
  t(build, "handyman", "Handyman", [], /handyman|odd job|property maintenance/),
  t(
    build,
    "cleaning",
    "Cleaning service",
    ["service.cleaning"],
    /clean|maid|janitor/,
  ),
  t(
    build,
    "pressure_washing",
    "Pressure washing and gutters",
    [],
    /pressure wash|power wash|gutter/,
  ),
  t(build, "pest_control", "Pest control", [], /pest|termite|extermin/),
  t(
    build,
    "pools",
    "Pool builder and service",
    ["commercial.houseware_and_hardware.swimming_pool"],
    /\bpools?\b/,
  ),
  t(build, "solar", "Solar installer", [], /solar/),
  t(
    build,
    "moving",
    "Movers and removals",
    ["office.logistics"],
    /moving|movers|removal/,
  ),
  t(build, "chimney", "Chimney sweep", ["service.chimney_sweeper"]),
  t(build, "locksmith", "Locksmith", [
    "service.locksmith",
    "service.key_cutter",
  ]),
  t(build, "metal", "Welding and metalwork", [
    "service.metal_construction",
    "service.blacksmith",
  ]),
  t(build, "architect", "Architect", ["office.architect"]),
  t(build, "building_materials", "Building materials supplier", [materials]),
  t(auto, "car_repair", "Car repair and mechanic", [
    "service.vehicle.repair.car",
  ]),
  t(auto, "motorcycle_repair", "Motorcycle repair", [
    "service.vehicle.repair.motorcycle",
  ]),
  t(
    auto,
    "car_wash",
    "Car wash and detailing",
    ["service.vehicle.car_wash"],
    /detailing|car wash/,
  ),
  t(auto, "driving_school", "Driving school", ["education.driving_school"]),
  t(beauty, "hairdresser", "Hairdresser and barber", [
    "service.beauty.hairdresser",
  ]),
  t(beauty, "massage", "Massage therapist", ["service.beauty.massage"]),
  t(beauty, "spa", "Spa and beauty salon", [
    "service.beauty.spa",
    "service.beauty.tanning_salon",
  ]),
  t(beauty, "tattoo", "Tattoo studio", ["service.beauty.tattoo"]),
  t(beauty, "gym", "Gym and fitness studio", [
    "sport.fitness.fitness_centre",
    "sport.fitness.gym",
  ]),
  t(food, "restaurant", "Restaurant", ["catering.restaurant"]),
  t(food, "cafe", "Cafe", ["catering.cafe"]),
  t(food, "takeaway", "Takeaway and fast food", ["catering.fast_food"]),
  t(food, "pub", "Pub and bar", ["catering.pub", "catering.bar"]),
  t(food, "bakery", "Bakery", ["commercial.food_and_drink.bakery"]),
  t(food, "butcher", "Butcher", ["commercial.food_and_drink.butcher"]),
  t(health, "dentist", "Dentist", ["healthcare.dentist"]),
  t(health, "vet", "Vet", ["pet.veterinary"]),
  t(
    health,
    "pet_services",
    "Pet grooming and services",
    ["pet.service"],
    /groom/,
  ),
  t(health, "pet_boarding", "Kennels and pet boarding", [
    "pet.animal_boarding",
  ]),
  t(other, "florist", "Florist", ["commercial.florist"]),
  t(other, "photographer", "Photographer", ["service.photographer"]),
  t(other, "tailor", "Tailor and alterations", ["service.tailor"]),
  t(other, "shoe_repair", "Shoe repair", ["service.shoemaker"]),
  t(other, "accountant", "Accountant", [
    "office.accountant",
    "office.tax_advisor",
  ]),
  t(other, "lawyer", "Lawyer", ["office.lawyer", "office.notary"]),
  t(other, "estate_agent", "Real estate agent", [
    "office.estate_agent",
    "service.estate_agent",
  ]),
  t(other, "insurance", "Insurance broker", ["office.insurance"]),
  t(other, "childcare", "Childcare and daycare", [
    "childcare",
    "service.social_facility.day_care",
  ]),
  t(other, "storage", "Self storage", ["rental.storage"]),
  t(other, "funeral", "Funeral director", ["service.funeral_directors"]),
];
/** One-click groups of trades for the search form, each within the limit. */
export const localTradePresets: { label: string; trades: string[] }[] = [
  {
    label: "Building trades",
    trades: [
      "construction",
      "roofing",
      "plumbing",
      "electrician",
      "hvac",
      "carpenter",
      "painting",
      "concrete",
      "masonry",
      "fencing",
    ],
  },
  {
    label: "Home services",
    trades: [
      "landscaping",
      "tree_service",
      "cleaning",
      "pressure_washing",
      "pest_control",
      "handyman",
      "pools",
      "solar",
      "moving",
      "flooring",
    ],
  },
  {
    label: "Auto",
    trades: ["car_repair", "motorcycle_repair", "car_wash", "driving_school"],
  },
  {
    label: "Food and drink",
    trades: ["restaurant", "cafe", "takeaway", "pub", "bakery", "butcher"],
  },
  {
    label: "Health and pets",
    trades: ["dentist", "vet", "pet_services", "pet_boarding"],
  },
];

/** The categories one search asks Geoapify for. */
export const tradeCategories = (trade: LocalTrade) => [
  ...new Set([...trade.categories, ...(trade.broad ? broadCategories : [])]),
];
export const localTrade = (id: string) => localTrades.find((t) => t.id === id);

const text = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const asUrl = (v: unknown, base?: string) => {
  const t = text(v);
  if (!t) return null;
  try {
    const u = new URL(
      /^https?:\/\//i.test(t)
        ? t
        : base
          ? `${base}${t.replace(/^@/, "")}`
          : `https://${t}`,
    );
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
};

type GeoapifyFeature = {
  properties?: Record<string, unknown> & {
    contact?: Record<string, unknown>;
    datasource?: { raw?: Record<string, unknown>; url?: unknown };
  };
};
export type GeoapifyPlace = {
  place_id: string;
  name: string;
  city: string | null;
  country: Country | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  opening_hours: string | null;
  lat: number | null;
  lon: number | null;
  osm_url: string | null;
  social_links: SocialLink[];
  /** Geoapify's categories for the place, space-separated. */
  tags: string;
  /** The OpenStreetMap craft/office/shop values, for name-matched trades. */
  trade_tags: string;
  /** Whether the response carried contact details at all (else ask Details). */
  has_contact_fields: boolean;
  /** A branch of a brand or franchise, whose website is the brand's. */
  chain: boolean;
};

/**
 * A Geoapify feature as a business. Website and phone are read from the
 * normalized fields first, then from the raw OpenStreetMap tags.
 */
export function readGeoapifyPlace(
  feature: GeoapifyFeature,
): GeoapifyPlace | null {
  const p = feature.properties ?? {};
  const raw = p.datasource?.raw ?? {};
  const id = text(p.place_id);
  const name = text(p.name) ?? text(raw.name);
  if (!id || !name) return null;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = k.startsWith("raw:")
        ? raw[k.slice(4)]
        : k.startsWith("contact.")
          ? p.contact?.[k.slice(8)]
          : p[k];
      const t = text(v);
      if (t) return t;
    }
    return null;
  };
  const social: SocialLink[] = [];
  const add = (network: SocialNetwork, value: unknown, base: string) => {
    const url = asUrl(value, base);
    if (url && !social.some((s) => s.url === url))
      social.push({ network, url });
  };
  add(
    "facebook",
    raw["contact:facebook"] ?? raw.facebook,
    "https://www.facebook.com/",
  );
  add(
    "instagram",
    raw["contact:instagram"] ?? raw.instagram,
    "https://www.instagram.com/",
  );
  add("linkedin", raw["contact:linkedin"], "https://www.linkedin.com/company/");
  add("tiktok", raw["contact:tiktok"], "https://www.tiktok.com/@");
  add("x", raw["contact:twitter"] ?? raw.twitter, "https://x.com/");
  add("youtube", raw["contact:youtube"], "https://www.youtube.com/");
  const osmType = text(raw.osm_type);
  const osmId =
    num(raw.osm_id) ?? (text(raw.osm_id) ? Number(raw.osm_id) : null);
  const osmKind = { n: "node", w: "way", r: "relation" }[osmType ?? ""] ?? null;
  const categories = Array.isArray(p.categories) ? p.categories.join(" ") : "";
  return {
    place_id: id,
    name,
    city: text(p.city),
    country: (() => {
      const code = text(p.country_code)?.toUpperCase();
      return code === "US" || code === "GB" || code === "CA" || code === "AU"
        ? code
        : null;
    })(),
    address: text(p.formatted) ?? text(p.address_line2),
    phone: pick("contact.phone", "raw:phone", "raw:contact:phone"),
    email: pick("contact.email", "raw:email", "raw:contact:email"),
    website: asUrl(
      pick("website", "raw:website", "raw:contact:website", "raw:url"),
    ),
    opening_hours: pick("opening_hours", "raw:opening_hours"),
    lat: num(p.lat),
    lon: num(p.lon),
    osm_url:
      osmKind && osmId && Number.isFinite(osmId)
        ? `https://www.openstreetmap.org/${osmKind}/${osmId}`
        : null,
    social_links: social,
    tags: categories.toLowerCase(),
    trade_tags: [raw.craft, raw.office, raw.shop]
      .map((v) => (typeof v === "string" ? v : ""))
      .join(" ")
      .toLowerCase(),
    has_contact_fields:
      "website" in p || "contact" in p || Object.keys(raw).length > 0,
    chain: !!(text(p.brand) || text(raw.brand) || text(raw["brand:wikidata"])),
  };
}

/** Whether a business belongs to the trade searched for. */
// Trades skip suppliers and rental yards: "Crawford Electric Supply" sells
// to electricians and is not one. Building suppliers are the exception.
const notATrade =
  /suppl(y|ies)|wholesale|warehouse|depot|distribut|rental|\bhire\b|outlet/;
export function inTrade(trade: LocalTrade, place: GeoapifyPlace) {
  if (
    trade.id !== "building_materials" &&
    notATrade.test(place.name.toLowerCase())
  )
    return false;
  const categories = place.tags.split(/\s+/);
  if (trade.categories.some((c) => categories.includes(c))) return true;
  if (!trade.broad || !trade.match) return false;
  // Only the name and the craft/office tag say what a business does; the
  // place's map categories (an office building, say) don't.
  return trade.match.test(`${place.name} ${place.trade_tags}`.toLowerCase());
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
