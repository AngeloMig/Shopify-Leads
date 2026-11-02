import { daysSince, type CatalogEvidence, type FitResult } from "./catalog.js";
import {
  contactCategory,
  mailStatus,
  type MailChecks,
} from "./lead-intelligence.js";
import { scorePriority } from "./scoring.js";
import type { Finding, Lead, PublicEmail } from "./types.js";

export type TimingSignal = {
  kind: "new_products" | "catalog_growth" | "score_drop" | "new_tool";
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
const newProductDays = 30,
  scoreDropPoints = 10,
  growthProducts = 3,
  growthRatio = 1.1;
/** Observed reasons to contact a store now. None of these imply buying intent. */
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
    const added = current.technologies.filter(
      (tool) => !prior.technologies!.includes(tool),
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
  if (input.performance !== null && input.performance < 50)
    return {
      label,
      strength: 1,
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
const scoreWeights = {
  service_fit: 20,
  verified_opportunity: 25,
  timing: 20,
  activity: 10,
  contact: 10,
  feasible_scope: 15,
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
        Math.max(0, 16 - earnedPoints.service_fit),
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
  const evidence = {
    service_fit: serviceFit(input, verified),
    verified_opportunity: opportunity(input, verified),
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
    countryVerified: !!lead.country && !!lead.country_evidence,
    shopifyVerified: lead.shopify_verified,
    permissionApproved: lead.permission === "approved",
    suppressed: lead.suppressed,
  });
