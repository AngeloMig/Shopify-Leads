export const median = (values: number[]) => {
  if (!values.length || values.some((v) => !Number.isFinite(v))) return null;
  const a = [...values].sort((a, b) => a - b);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
/** How fully a component's evidence is met: true/false, or a share from 0 to 1. */
type Strength = boolean | number;
const earned = (max: number, strength: Strength) =>
  Math.round(max * Math.max(0, Math.min(1, Number(strength))));
export type PriorityEvidence = {
  serviceFit: Strength;
  verifiedOpportunity: Strength;
  timingSignal: Strength;
  active: Strength;
  appropriateContact: Strength;
  feasibleScope: Strength;
  /** An independent business, not a brand with its own team. Unset counts in full. */
  independent?: Strength;
  /** The most it can score, whatever else it earns: a brand with its own team. */
  cap?: number;
  countryVerified: boolean;
  shopifyVerified: boolean;
  permissionApproved: boolean;
  suppressed: boolean;
};
export function scorePriority(e: PriorityEvidence) {
  const components = {
    service_fit: earned(15, e.serviceFit),
    verified_opportunity: earned(20, e.verifiedOpportunity),
    independent: earned(20, e.independent ?? 1),
    timing: earned(15, e.timingSignal),
    activity: earned(10, e.active),
    contact: earned(10, e.appropriateContact),
    feasible_scope: earned(10, e.feasibleScope),
  };
  const researchScore = Math.min(
    e.cap ?? 100,
    Object.values(components).reduce((a, b) => a + b, 0),
  );
  const gates = {
    country: e.countryVerified,
    platform: e.shopifyVerified,
    service_fit: !!e.serviceFit,
    contact_permission: e.permissionApproved,
    suppression: !e.suppressed,
  };
  const eligible = Object.values(gates).every(Boolean);
  return {
    components,
    researchScore,
    priority: eligible ? researchScore : 0,
    band: eligible
      ? researchScore >= 70
        ? "A"
        : researchScore >= 50
          ? "B"
          : "Hold"
      : "Hold",
    gates,
    eligible,
  };
}
export function qualifies(
  s: {
    performance: number | null;
    seo: number | null;
    modernization?: number | null;
    verifiedCro?: boolean;
    explicitNeed?: boolean;
  },
  thresholds: {
    mobile_threshold: number;
    seo_threshold: number;
    modernization_threshold: number;
  },
) {
  return (
    (s.performance !== null && s.performance <= thresholds.mobile_threshold) ||
    (s.seo !== null && s.seo <= thresholds.seo_threshold) ||
    (s.modernization != null &&
      s.modernization >= thresholds.modernization_threshold) ||
    s.verifiedCro === true ||
    s.explicitNeed === true
  );
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
