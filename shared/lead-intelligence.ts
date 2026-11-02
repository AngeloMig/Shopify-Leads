import type { Lead, PublicEmail } from "./types.js";
import { reportIssues } from "./audit-presentation.js";
import { explainFinding } from "./finding-explanation.js";

export type ContactCategory =
  | "General business"
  | "Support"
  | "Wholesale"
  | "Careers"
  | "Unknown";
export function contactCategory(email: string): ContactCategory {
  const local = email.split("@")[0].toLowerCase();
  if (
    /^(hr|career|careers|jobs|recruitment|recruiting|talent)([._+-]|$)/.test(
      local,
    )
  )
    return "Careers";
  if (/wholesale|stockist|trade|b2b/.test(local)) return "Wholesale";
  if (
    /support|service|help|returns|orders|customercare|customer[._-]care/.test(
      local,
    )
  )
    return "Support";
  if (
    /^(hello|info|contact|enquiries|inquiries|business|office|admin|shop|sales)([._+-]|$)/.test(
      local,
    )
  )
    return "General business";
  return "Unknown";
}
const contactWeight: Record<ContactCategory, number> = {
  "General business": 0,
  Support: 1,
  Unknown: 2,
  Wholesale: 3,
  Careers: 4,
};
export const hasFrontendOpportunity = (lead: Pick<Lead, "findings">) =>
  lead.findings.some(
    (f) =>
      f.kind === "verified" &&
      ["Modernization", "Accessibility", "Frontend", "Images"].includes(
        f.category,
      ),
  );
/** Saved per email domain. "unknown" means the lookup failed or hasn't run. */
export type MailStatus = "ok" | "none" | "unknown";
export type MailChecks = Record<string, MailStatus>;
export const mailStatus = (email: string, mail?: MailChecks | null) =>
  mail?.[email.split("@")[1]?.toLowerCase()] ?? "unknown";
export function rankedEmails(
  emails: PublicEmail[] = [],
  preferred?: string | null,
  mail?: MailChecks | null,
) {
  const dead = (email: string) => Number(mailStatus(email, mail) === "none");
  return [...emails].sort(
    (a, b) =>
      Number(b.email.toLowerCase() === preferred?.toLowerCase()) -
        Number(a.email.toLowerCase() === preferred?.toLowerCase()) ||
      dead(a.email) - dead(b.email) ||
      contactWeight[contactCategory(a.email)] -
        contactWeight[contactCategory(b.email)] ||
      a.email.localeCompare(b.email),
  );
}
export function shortBusinessName(name: string, domain: string) {
  const prefix = name.match(/^([^:]{2,40}):\s/);
  if (prefix) return prefix[1].trim();
  const parts = name
    .split(/\s+[|–—]\s+|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const root = domain
    .replace(/^www\./, "")
    .split(".")[0]
    .toLowerCase();
  const brand = parts.find(
    (s) =>
      s.length < 45 &&
      s
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]/g, "")
        .includes(root.replace(/[^a-z0-9]/g, "")),
  );
  return (
    (brand ??
      (parts[0]?.length <= 45 ? parts[0] : domain.replace(/^www\./, ""))) ||
    domain
  );
}
export function leadIntelligence(lead: Lead, at = Date.now()) {
  const issues = reportIssues(lead.findings, []);
  const verified = issues.filter((f) => f.kind === "verified");
  const strong =
    verified.some((f) => f.severity === "high") ||
    (verified.length > 0 && lead.performance !== null && lead.performance < 50);
  const rank = lead.suppressed ? -1 : strong ? 2 : verified.length ? 1 : 0;
  const label =
    rank === 2
      ? "Strong"
      : rank === 1
        ? "Moderate"
        : rank < 0
          ? "Suppressed"
          : "Needs evidence";
  const slow =
    lead.performance !== null && lead.performance <= 75 && verified.length > 0;
  const main = slow
    ? "Slow mobile loading"
    : verified[0]
      ? explainFinding(verified[0], lead.findings, []).title
      : "Manual review needed";
  const primary =
    (slow
      ? verified.find((f) => ["Frontend", "Images"].includes(f.category))
      : null) ?? verified[0];
  const reason = slow
    ? `Mobile performance ${Math.round(lead.performance!)}/100, with ${verified.length} supported improvement ${verified.length === 1 ? "area" : "areas"}.`
    : primary
      ? explainFinding(primary, lead.findings, []).meaning
      : "No verified improvement area is available yet.";
  const stale =
    !!lead.audited_at &&
    at - new Date(lead.audited_at).getTime() > 30 * 86400000;
  const emails = rankedEmails(
    lead.emails,
    lead.preferred_email,
    lead.mail_checks,
  );
  const review = lead.suppressed
    ? "Suppressed"
    : lead.permission === "approved"
      ? "Approved"
      : lead.permission === "rejected"
        ? "Not approved"
        : "Review pending";
  const next = lead.suppressed
    ? "Do not contact"
    : stale
      ? "Refresh old audit"
      : !emails.length && !lead.contact_url
        ? "Find contact"
        : lead.stage === "new" || !verified.length
          ? "Review findings"
          : lead.permission !== "approved"
            ? "Review outreach eligibility"
            : "Plan next step";
  return {
    rank,
    label,
    main,
    reason,
    service: primary?.service ?? "Collect more evidence before proposing work.",
    next,
    review,
    emails,
    stale,
    issues,
  };
}

const industryTerms: Record<string, string[]> = {
  "Fashion & apparel": [
    "clothing",
    "apparel",
    "dress",
    "dresses",
    "womenswear",
    "menswear",
    "fashion",
    "boutique",
    "wardrobe",
    "knitwear",
    "t-shirt",
  ],
  "Beauty & skincare": [
    "skincare",
    "skin care",
    "cleanser",
    "moisturiser",
    "moisturizer",
    "serum",
    "cosmetics",
    "makeup",
  ],
  "Home & furniture": [
    "furniture",
    "sofa",
    "sofas",
    "home decor",
    "home accessories",
    "dining table",
    "armchair",
    "home goods",
  ],
  "Food & beverage": [
    "coffee",
    "roasted",
    "tea",
    "snacks",
    "chocolate",
    "beverage",
    "artisan food",
  ],
  "Pet products": [
    "pet food",
    "dog food",
    "cat food",
    "pet accessories",
    "dog toys",
    "pet supplies",
  ],
  Electronics: [
    "electronics",
    "headphones",
    "smartphone",
    "charging cable",
    "computer accessories",
  ],
  "Health & wellness": [
    "supplements",
    "vitamins",
    "wellness",
    "protein powder",
    "nutrition",
  ],
};
export function classifyIndustry(
  pages: {
    title?: string;
    description?: string;
    h1?: string[];
    url?: string;
    kind?: string;
  }[],
) {
  const observed = pages.filter(
    (p) => !p.kind || ["homepage", "product", "collection"].includes(p.kind),
  );
  const text = observed
    .map((p) =>
      [p.title, p.description, ...(p.h1 ?? [])].join(" ").toLowerCase(),
    )
    .join(" ");
  const scores = Object.entries(industryTerms)
    .map(([industry, terms]) => ({
      industry,
      hits: terms.filter((term) =>
        new RegExp(
          `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i",
        ).test(text),
      ),
    }))
    .sort((a, b) => b.hits.length - a.hits.length);
  const best = scores[0];
  if (
    !best ||
    (best.hits.length < 2 &&
      !best.hits.some((hit) =>
        [
          "skincare",
          "skin care",
          "furniture",
          "cosmetics",
          "pet supplies",
          "electronics",
        ].includes(hit),
      )) ||
    best.hits.length === (scores[1]?.hits.length ?? 0)
  )
    return {
      industry: "Unknown",
      industry_confidence: "unknown",
      industry_evidence: "Insufficient or conflicting product-page evidence.",
    };
  return {
    industry: best.industry,
    industry_confidence: best.hits.length >= 4 ? "high" : "medium",
    industry_evidence: `Website text contains: ${best.hits.join(", ")}. Sources: ${observed
      .map((p) => p.url)
      .filter(Boolean)
      .join(", ")}`,
  };
}
