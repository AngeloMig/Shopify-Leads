import { daysSince, type CatalogEvidence, type FitResult } from "./catalog.js";
import {
  contactCategory,
  mailStatus,
  type MailChecks,
} from "./lead-intelligence.js";
import { scorePriority } from "./scoring.js";
import { brandSize, type BrandEvidence, type BrandSize } from "./brand-size.js";
import type { Finding, Lead, PublicEmail } from "./types.js";

export type TimingSignal = {
  kind:
    | "new_products"
    | "catalog_growth"
    | "score_drop"
    | "new_tool"
    | "paid_ads"
    | "new_store";
  label: string;
  evidence: string;
  source_url?: string;
};
/** What the previous audit of this store recorded, used to spot changes. */
export type PriorAudit = {
  performance: number | null;
  catalog?: CatalogEvidence | null;
  technologies?: string[] | null;
};
/** Ad tags: the store pays for visitors, so a slow phone page wastes that spend. */
export const adTools = [
  "Meta Pixel",
  "Google Ads",
  "TikTok Pixel",
  "Pinterest Tag",
];
const newStoreDays = 120,
  newStoreProducts = 3;
const newProductDays = 30,
  scoreDropPoints = 10,
  growthProducts = 3,
  growthRatio = 1.1;
/**
 * Observed reasons to contact a store now. None of these prove buying
 * intent: they're timing, such as a new store or one paying for traffic.
 */
export function detectTiming(
  current: {
    performance: number | null;
    catalog?: CatalogEvidence | null;
    technologies?: string[];
  },
  prior?: PriorAudit | null,
  at = Date.now(),
): TimingSignal[] {
  const signals: TimingSignal[] = [];
  const catalog = current.catalog;
  const age = daysSince(catalog?.newest_published_at, at);
  if (catalog && age !== null && age <= newProductDays)
    signals.push({
      kind: "new_products",
      label: "New products",
      evidence: `Newest product published ${age === 0 ? "today" : `${age} ${age === 1 ? "day" : "days"} ago`}.`,
      source_url: catalog.source_url,
    });
  const ads = (current.technologies ?? []).filter((t) => adTools.includes(t));
  if (ads.length)
    signals.push({
      kind: "paid_ads",
      label: "Pays for ads",
      evidence: `Has the ${ads.join(" and ")} ${ads.length === 1 ? "tag" : "tags"}, so it pays for visitors. A slow phone page wastes that spend.`,
    });
  // Only when the whole catalog fits in one page: otherwise older products
  // may be on pages we didn't read.
  const storeAge = daysSince(catalog?.oldest_published_at, at);
  if (
    catalog &&
    !catalog.count_capped &&
    catalog.product_count >= newStoreProducts &&
    storeAge !== null &&
    storeAge <= newStoreDays
  )
    signals.push({
      kind: "new_store",
      label: "New or relaunched store",
      evidence: `Every product in its catalog went live in the last ${storeAge} days, so the store looks new or relaunched.`,
      source_url: catalog.source_url,
    });
  if (!prior) return signals;
  if (
    prior.catalog &&
    catalog &&
    !prior.catalog.count_capped &&
    catalog.product_count - prior.catalog.product_count >= growthProducts &&
    catalog.product_count >= prior.catalog.product_count * growthRatio
  )
    signals.push({
      kind: "catalog_growth",
      label: "Catalog growing",
      evidence: `Catalog grew from ${prior.catalog.product_count} to ${catalog.product_count}${catalog.count_capped ? "+" : ""} products since the last audit.`,
      source_url: catalog.source_url,
    });
  if (
    prior.performance !== null &&
    current.performance !== null &&
    prior.performance - current.performance >= scoreDropPoints
  )
    signals.push({
      kind: "score_drop",
      label: "Site got slower",
      evidence: `Mobile performance fell from ${Math.round(prior.performance)} to ${Math.round(current.performance)} since the last audit.`,
    });
  // Without a recorded baseline, every tool would look new.
  if (prior.technologies && current.technologies) {
    // Ad tags have their own signal, and older audits didn't look for all.
    const added = current.technologies.filter(
      (tool) => !prior.technologies!.includes(tool) && !adTools.includes(tool),
    );
    if (added.length)
      signals.push({
        kind: "new_tool",
        label: "New tool added",
        evidence: `Added ${added.join(", ")} since the last audit.`,
      });
  }
  return signals;
}
const timingStrength: Record<TimingSignal["kind"], number> = {
  score_drop: 1,
  paid_ads: 0.8,
  new_store: 0.7,
  new_tool: 0.75,
  catalog_growth: 0.6,
  new_products: 0.5,
};
export type LeadScoreInput = {
  findings: Pick<Finding, "kind" | "severity" | "category">[];
  performance: number | null;
  activity: number | null;
  emails?: Pick<PublicEmail, "email">[];
  mail?: MailChecks | null;
  contact_url?: string | null;
  catalog?: CatalogEvidence | null;
  fit?: FitResult | null;
  timing?: TimingSignal[] | null;
  /** For the brand-size check: the store's domain, title and home page signals. */
  domain?: string;
  title?: string | null;
  brand_evidence?: BrandEvidence | null;
  countryVerified: boolean;
  shopifyVerified: boolean;
  permissionApproved: boolean;
  suppressed: boolean;
};
type Part = { label: string; strength: number; reason: string };
function opportunity(
  input: LeadScoreInput,
  verified: LeadScoreInput["findings"],
): Part {
  const label = "Verified opportunity";
  if (!verified.length)
    return { label, strength: 0, reason: "No verified finding yet." };
  if (verified.some((f) => f.severity === "high"))
    return {
      label,
      strength: 1,
      reason: "A high-severity finding is verified.",
    };
  // How slow it is matters: 25/100 is a much easier case to make than 48.
  if (input.performance !== null && input.performance < 30)
    return {
      label,
      strength: 1,
      reason: `Mobile performance is ${Math.round(input.performance)}/100: very slow, with a verified finding.`,
    };
  if (input.performance !== null && input.performance < 50)
    return {
      label,
      strength: 0.75,
      reason: `Mobile performance is ${Math.round(input.performance)}/100 with a verified finding.`,
    };
  return verified.some((f) => f.severity === "medium")
    ? { label, strength: 0.6, reason: "Medium-severity findings are verified." }
    : {
        label,
        strength: 0.3,
        reason: "Only low-severity findings are verified.",
      };
}
function serviceFit(
  input: LeadScoreInput,
  verified: LeadScoreInput["findings"],
): Part {
  const label = "Fit with your ideal client";
  if (!verified.length)
    return {
      label,
      strength: 0,
      reason: "Nothing verified to offer a service for.",
    };
  const status = input.fit?.status;
  if (status === "fits")
    return {
      label,
      strength: 1,
      reason: "Matches this campaign's ideal client.",
    };
  if (status === "outside")
    return {
      label,
      strength: 0.25,
      reason: `Outside the ideal client: ${input.fit!.reasons.join("; ")}.`,
    };
  return input.catalog
    ? {
        label,
        strength: 0.8,
        reason: "Catalog confirmed; no ideal client set for this campaign.",
      }
    : { label, strength: 0.6, reason: "Catalog size and prices are unknown." };
}
function scope(verified: LeadScoreInput["findings"]): Part {
  const label = "Clear scope of work";
  const areas = new Set(verified.map((f) => f.category)).size;
  if (!areas)
    return { label, strength: 0, reason: "No verified area to scope." };
  return areas >= 2 || verified.length >= 3
    ? {
        label,
        strength: 1,
        reason: `${verified.length} verified findings across ${areas} ${areas === 1 ? "area" : "areas"}.`,
      }
    : { label, strength: 0.6, reason: "One verified area, so a small scope." };
}
function timing(signals: TimingSignal[]): Part {
  const label = "Timing";
  if (!signals.length)
    return { label, strength: 0, reason: "No recent change observed." };
  const best = Math.max(...signals.map((s) => timingStrength[s.kind]));
  return {
    label,
    strength: Math.min(1, best + 0.15 * (signals.length - 1)),
    reason: signals.map((s) => s.evidence).join(" "),
  };
}
function activity(input: LeadScoreInput): Part {
  const label = "Store activity";
  const age = daysSince(input.catalog?.newest_published_at);
  if (age !== null && age <= 90)
    return {
      label,
      strength: 1,
      reason: "Added a product in the last 90 days.",
    };
  if (age !== null && age > 365)
    return { label, strength: 0.25, reason: `No new product for ${age} days.` };
  return (input.activity ?? 0) >= 50
    ? {
        label,
        strength: 0.5,
        reason: "Selling publicly; recent activity unknown.",
      }
    : { label, strength: 0, reason: "Public selling signals are weak." };
}
/** An email earns nothing once its domain is shown to take no mail. Unknown still counts. */
const usableEmails = (input: LeadScoreInput) =>
  (input.emails ?? []).filter(
    (e) => mailStatus(e.email, input.mail) !== "none",
  );
function contact(input: LeadScoreInput): Part {
  const label = "Contact route";
  const usable = usableEmails(input);
  const categories = usable.map((e) => contactCategory(e.email));
  if (categories.includes("General business"))
    return {
      label,
      strength: 1,
      reason: "A general business email is published.",
    };
  if (categories.includes("Support"))
    return {
      label,
      strength: 0.7,
      reason: "Only a support email is published.",
    };
  if (categories.includes("Unknown") || categories.includes("Wholesale"))
    return {
      label,
      strength: 0.6,
      reason: "A public email is published; its role is unclear.",
    };
  const dead = !!input.emails?.length;
  return input.contact_url
    ? {
        label,
        strength: 0.5,
        reason: dead
          ? "Contact page only; the published email's domain takes no mail."
          : "Contact page only; no public email found.",
      }
    : {
        label,
        strength: 0,
        reason: dead
          ? "The published email's domain takes no mail."
          : "No public contact route found.",
      };
}
function independence(input: LeadScoreInput, brand: BrandSize | null): Part {
  const label = "Independent business";
  if (!brand)
    return { label, strength: 0.7, reason: "Brand size not checked." };
  const seen = brand.signals.map((s) => s.label).join("; ");
  return brand.verdict === "independent"
    ? {
        label,
        strength: 1,
        reason:
          "No sign of a big brand: no country stores, department inboxes or staff lists.",
      }
    : brand.verdict === "possibly_established"
      ? {
          label,
          strength: 0.5,
          reason: `Possibly an established brand: ${seen}.`,
        }
      : {
          label,
          strength: 0,
          reason: `Likely has its own team or agency: ${seen}.`,
        };
}
const scoreWeights = {
  service_fit: 15,
  verified_opportunity: 20,
  independent: 20,
  timing: 15,
  activity: 10,
  contact: 10,
  feasible_scope: 10,
};
/** Things a researcher can actually do, with the most points each could add. */
function raiseScore(
  input: LeadScoreInput,
  earnedPoints: Record<keyof typeof scoreWeights, number>,
) {
  const room = (key: keyof typeof scoreWeights) =>
    scoreWeights[key] - earnedPoints[key];
  const steps: { label: string; points: number }[] = [];
  if (!input.catalog)
    steps.push({
      label: "Re-audit to read its catalog",
      points:
        room("activity") +
        room("timing") +
        Math.max(
          0,
          Math.round(scoreWeights.service_fit * 0.8) - earnedPoints.service_fit,
        ),
    });
  else if (!input.fit || input.fit.status === "not_set")
    steps.push({
      label: "Set an ideal client on this campaign",
      points: room("service_fit"),
    });
  if (!usableEmails(input).length)
    steps.push({
      label: "Find a public business email",
      points: room("contact"),
    });
  return steps
    .filter((step) => step.points > 0)
    .sort((a, b) => b.points - a.points);
}
const gateLabels = {
  country: "country check",
  platform: "Shopify check",
  service_fit: "a verified finding",
  contact_permission: "outreach review",
  suppression: "suppression removal",
};
/** Every point has its own evidence and a plain reason. */
export function leadScore(input: LeadScoreInput) {
  const verified = input.findings.filter((f) => f.kind === "verified");
  const brand = input.domain
    ? brandSize({
        domain: input.domain,
        title: input.title,
        emails: input.emails,
        catalog: input.catalog,
        evidence: input.brand_evidence,
      })
    : null;
  const evidence = {
    service_fit: serviceFit(input, verified),
    verified_opportunity: opportunity(input, verified),
    independent: independence(input, brand),
    timing: timing(input.timing ?? []),
    activity: activity(input),
    contact: contact(input),
    feasible_scope: scope(verified),
  };
  const result = scorePriority({
    serviceFit: evidence.service_fit.strength,
    verifiedOpportunity: evidence.verified_opportunity.strength,
    timingSignal: evidence.timing.strength,
    active: evidence.activity.strength,
    appropriateContact: evidence.contact.strength,
    feasibleScope: evidence.feasible_scope.strength,
    independent: evidence.independent.strength,
    // A brand with its own team sits below every independent prospect.
    cap: brand?.verdict === "likely_agency" ? 49 : undefined,
    countryVerified: input.countryVerified,
    shopifyVerified: input.shopifyVerified,
    permissionApproved: input.permissionApproved,
    suppressed: input.suppressed,
  });
  return {
    ...result,
    /** The priority band this research earns, whether or not its gates pass yet. */
    grade:
      result.researchScore >= 70
        ? "A"
        : result.researchScore >= 50
          ? "B"
          : "Hold",
    raise: raiseScore(input, result.components),
    /** Whether it looks like a brand with its own team; null when not checked. */
    brand,
    /** What still holds priority at 0, in plain words. */
    blockers: (Object.keys(gateLabels) as (keyof typeof gateLabels)[])
      .filter((gate) => !result.gates[gate])
      .map((gate) => gateLabels[gate]),
    parts: (Object.keys(evidence) as (keyof typeof evidence)[]).map((key) => ({
      key,
      label: evidence[key].label,
      reason: evidence[key].reason,
      points: result.components[key],
      max: scoreWeights[key],
    })),
  };
}
export const leadScoreFor = (lead: Lead) =>
  leadScore({
    findings: lead.findings,
    performance: lead.performance,
    activity: lead.activity,
    emails: lead.emails,
    mail: lead.mail_checks,
    contact_url: lead.contact_url,
    catalog: lead.catalog,
    fit: lead.fit,
    timing: lead.timing_signals,
    domain: lead.domain,
    title: lead.original_name ?? lead.name,
    brand_evidence: lead.brand_evidence,
    countryVerified: !!lead.country && !!lead.country_evidence,
    shopifyVerified: lead.shopify_verified,
    permissionApproved: lead.permission === "approved",
    suppressed: lead.suppressed,
  });
