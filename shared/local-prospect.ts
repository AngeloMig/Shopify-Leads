// How likely a local business is to buy a website, from what Scout knows
// about it. Every point has a reason the user can read, so the score can be
// checked rather than trusted.
import {
  localTrades,
  type GeoapifyPlace,
  type LocalBusiness,
} from "./local-business.js";

/**
 * How much a website wins a trade work. High: customers compare online
 * before a big or trusted job. Low: walk-in trade, where a map pin does most
 * of the work.
 */
const tradeTier: Record<string, "high" | "low"> = Object.fromEntries([
  ...[
    "construction",
    "roofing",
    "plumbing",
    "electrician",
    "hvac",
    "carpenter",
    "painting",
    "concrete",
    "masonry",
    "landscaping",
    "tree_service",
    "fencing",
    "flooring",
    "windows",
    "kitchens",
    "pest_control",
    "pools",
    "solar",
    "moving",
    "architect",
    "dentist",
    "vet",
    "lawyer",
    "accountant",
    "estate_agent",
    "photographer",
    "childcare",
    "spa",
    "gym",
    "car_repair",
  ].map((id) => [id, "high" as const]),
  ...[
    "takeaway",
    "pub",
    "butcher",
    "shoe_repair",
    "building_materials",
    "storage",
  ].map((id) => [id, "low" as const]),
]);
/** Trades where a website pays most: the finder's "Most likely to buy" pick. */
export const bestBetTrades = [
  "construction",
  "roofing",
  "plumbing",
  "electrician",
  "hvac",
  "landscaping",
  "kitchens",
  "solar",
  "dentist",
  "lawyer",
];

export type ProspectTier = "strong" | "good" | "weak";
export type Prospect = {
  score: number;
  tier: ProspectTier;
  reasons: { points: number; text: string }[];
};
export const tierLabel: Record<ProspectTier, string> = {
  strong: "Strong prospect",
  good: "Good prospect",
  weak: "Weak prospect",
};
type Scored = Pick<
  LocalBusiness,
  | "trade"
  | "website_check"
  | "social_links"
  | "phone"
  | "email"
  | "opening_hours"
>;
const tradeId = (label: string) =>
  localTrades.find((t) => t.label === label || t.id === label)?.id ?? "";

export function prospectScore(b: Scored): Prospect {
  const reasons: Prospect["reasons"] = [];
  const add = (points: number, text: string) => reasons.push({ points, text });
  const tier = tradeTier[tradeId(b.trade)];
  if (tier === "high")
    add(30, `${b.trade}: customers look them up online before hiring`);
  else if (tier === "low")
    add(10, `${b.trade}: mostly walk-in trade, so a site matters less`);
  else add(20, `${b.trade}: a site brings in some new customers`);
  if (b.website_check === "no_site_found")
    add(25, "A web search found no site of their own");
  else if (b.website_check === "not_checked")
    add(10, "No site on the map listing (not checked further)");
  const networks = new Set(b.social_links.map((s) => s.network));
  if (networks.has("facebook") || networks.has("instagram"))
    add(20, "Markets itself on Facebook or Instagram already");
  else if (networks.size) add(10, "Has a social page");
  if (b.phone) add(15, "Phone number listed, so you can call today");
  if (b.email) add(5, "Email listed");
  if (b.opening_hours) add(5, "Keeps its listing up to date (opening hours)");
  let score = reasons.reduce((n, r) => n + r.points, 0);
  // A business with a site of its own is a redesign lead at best.
  if (b.website_check === "site_found") {
    score = Math.min(score, 15);
    reasons.push({ points: 0, text: "Already has a website" });
  }
  score = Math.min(100, score);
  return {
    score,
    tier: score >= 70 ? "strong" : score >= 45 ? "good" : "weak",
    reasons,
  };
}

/**
 * The order a search takes one city's listings in, best first, so the
 * per-trade cap keeps the likeliest buyers. Listings that show a website
 * go last: they're skipped anyway and shouldn't use up places.
 */
export const listingPriority = (p: GeoapifyPlace) =>
  (p.website ? -10 : 0) +
  (p.phone ? 3 : 0) +
  (p.social_links.length ? 3 : 0) +
  (p.email ? 1 : 0) +
  (p.opening_hours ? 1 : 0);
