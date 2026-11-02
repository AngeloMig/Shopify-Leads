import type { Finding, PsiSample } from "./types.js";
import { median } from "./scoring.js";

export const readable = (value: string) =>
  value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\u2026/g, "...")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=");
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
export const bytes = (value: number) =>
  value >= 1e6
    ? `${(value / 1e6).toFixed(2)} MB`
    : value >= 1000
      ? `${(value / 1000).toFixed(1)} kB`
      : `${Math.round(value)} B`;
export const lighthouseIdentity = (
  sample: Pick<PsiSample, "url" | "environment">,
) =>
  JSON.stringify([
    sample.url,
    sample.environment?.lighthouse_version ?? null,
    sample.environment?.form_factor ?? null,
    sample.environment?.throttling_method ?? null,
  ]);
export function comparableRuns(
  samples: PsiSample[],
  strategy: "mobile" | "desktop",
) {
  const runs = samples
    .filter((sample) => sample.strategy === strategy)
    .sort((a, b) => a.sample - b.sample);
  const comparable =
    runs.length === 3 &&
    new Set(runs.map((run) => run.sample)).size === 3 &&
    runs.every(
      (run) =>
        [1, 2, 3].includes(run.sample) &&
        !!run.environment?.lighthouse_version &&
        !!run.environment?.form_factor &&
        lighthouseIdentity(run) === lighthouseIdentity(runs[0]),
    );
  return {
    runs,
    comparable,
    distinctTimes: new Set(runs.map((run) => run.tested_at)).size,
    score: (key: string) => {
      const values = runs.map((run) => run.scores[key]);
      return comparable &&
        values.every((value) => finite(value) && value >= 0 && value <= 100)
        ? median(values as number[])
        : null;
    },
    metric: (key: string) => {
      const values = runs.map(
        (run) =>
          (run.diagnostics[key] as { numericValue?: unknown } | undefined)
            ?.numericValue,
      );
      return comparable && values.every((value) => finite(value) && value >= 0)
        ? median(values as number[])
        : null;
    },
  };
}
const guidance = (title: string, fallback: string) => {
  if (/unused javascript/i.test(title))
    return {
      meaning:
        "JavaScript was downloaded but not used during the recorded page load. This includes code that may be needed for interactions later.",
      action:
        "Review theme bundles and third-party tags. Defer nonessential scripts, load features when needed, and remove unused app integrations only after testing their behavior.",
      validation:
        "Repeat the same mobile and desktop tests. Compare JavaScript transfer size, main-thread work and LCP; test cart, navigation, consent and analytics behavior.",
      service: "JavaScript and third-party app performance review",
    };
  if (
    /image delivery|optimized images|responsive images|properly size images/i.test(
      title,
    )
  )
    return {
      meaning:
        "Lighthouse identified images whose delivery or size can be improved for the tested viewport.",
      action:
        "Review the flagged images. Serve responsive image widths, appropriate compression and modern formats where supported. Keep the main visual prioritized and lazy-load suitable below-fold images.",
      validation:
        "Compare image transfer sizes and LCP at the same viewport, then check visual sharpness, cropping and layout stability.",
      service: "Shopify image and responsive media optimization",
    };
  if (/render.blocking|unused css/i.test(title))
    return {
      meaning:
        "The recorded page load contains styling or resources that may delay rendering or add unnecessary transfer.",
      action: readable(fallback),
      validation:
        "Re-test the affected page and check rendering, layout stability and interaction behavior across breakpoints.",
      service: "Theme asset and rendering performance review",
    };
  if (/contrast|button.*name|link.*name/i.test(title))
    return {
      meaning:
        "An automated accessibility check flagged elements that need human review.",
      action: readable(fallback),
      validation:
        "Inspect the flagged elements with keyboard and assistive-technology checks, then rerun the relevant automated check.",
      service: "Accessibility remediation and manual verification",
    };
  return {
    meaning:
      "The public-page inspection recorded the observation below. Its scope is limited to the pages and conditions tested.",
    action: readable(fallback),
    validation:
      "Verify the observation on the affected page, implement the scoped change and repeat the relevant check.",
    service: "Scoped Shopify frontend improvement",
  };
};
export type ReportIssue = {
  reference: string;
  title: string;
  category: string;
  severity: Finding["severity"];
  kind: Finding["kind"];
  confidence: Finding["confidence"];
  urls: string[];
  ids: string[];
  meaning: string;
  action: string;
  validation: string;
  service: string;
  evidence: string[];
  resources: { url: string; wastedBytes?: number; strategy: string }[];
};
export function reportIssues(
  findings: Finding[],
  samples: PsiSample[],
): ReportIssue[] {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = JSON.stringify([
      finding.category,
      finding.title.trim().toLowerCase(),
      finding.kind,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  const weight = { high: 0, medium: 1, low: 2 };
  return [...groups.values()]
    .sort(
      (a, b) =>
        Number(a[0].kind !== "verified") - Number(b[0].kind !== "verified") ||
        Math.min(...a.map((finding) => weight[finding.severity])) -
          Math.min(...b.map((finding) => weight[finding.severity])),
    )
    .map((group, index) => {
      const first = group[0];
      const detail = guidance(first.title, first.recommendation);
      const evidence: string[] = [];
      const resources: ReportIssue["resources"] = [];
      for (const finding of group) {
        if (!finding.evidence.startsWith("Lighthouse ")) {
          const alt = finding.evidence.match(
            /^(\d+)\/(\d+) images have no alt attribute/i,
          );
          const duplicate = /^Repeated src attributes:/i.test(finding.evidence);
          if (alt)
            evidence.push(
              `${alt[1]} of ${alt[2]} image elements have no alt attribute in the returned HTML. Review the example resources below in context.`,
            );
          else if (duplicate)
            evidence.push(
              "The same script source is referenced more than once in the returned HTML. This does not by itself prove duplicate execution or a measured performance penalty.",
            );
          else
            evidence.push(
              readable(
                finding.evidence.length > 450
                  ? `${finding.evidence.slice(0, 420)}... Full observation retained in Scout.`
                  : finding.evidence,
              ),
            );
          if (alt || duplicate)
            for (const match of finding.evidence.matchAll(
              /https?:\/\/[^\s,]+/g,
            ))
              resources.push({ url: match[0], strategy: "HTML example" });
          continue;
        }
        const strategy = finding.evidence.match(
          /^Lighthouse (mobile|desktop) /,
        )?.[1];
        const run = samples.find(
          (sample) =>
            sample.sample === 1 &&
            sample.strategy === strategy &&
            sample.url === finding.url,
        );
        const diagnostic = run
          ? (Object.values(run.diagnostics).find(
              (value) =>
                !!value &&
                typeof value === "object" &&
                (value as { title?: string }).title === finding.title,
            ) as Record<string, any> | undefined)
          : undefined;
        const label =
          strategy === "desktop"
            ? "Desktop"
            : strategy === "mobile"
              ? "Mobile"
              : "Lighthouse";
        const parts: string[] = [];
        if (finite(diagnostic?.details?.overallSavingsBytes))
          parts.push(
            `${bytes(diagnostic.details.overallSavingsBytes)} estimated transfer savings`,
          );
        if (finite(diagnostic?.details?.overallSavingsMs))
          parts.push(
            `${Math.round(diagnostic.details.overallSavingsMs)} ms estimated load-time opportunity`,
          );
        // Some new Lighthouse insights provide only displayValue; preserve its
        // units rather than deriving totals from overlapping resource sub-items.
        if (!parts.length && typeof diagnostic?.displayValue === "string")
          parts.push(readable(diagnostic.displayValue));
        evidence.push(
          `${label}: ${parts.join("; ") || "diagnostic flagged in the saved Lighthouse result"}${run ? ` (recorded ${run.tested_at})` : ""}.`,
        );
        for (const item of Array.isArray(diagnostic?.details?.items)
          ? diagnostic.details.items
          : [])
          if (
            typeof item?.url === "string" &&
            finite(item.wastedBytes) &&
            item.wastedBytes > 0
          )
            resources.push({
              url: item.url,
              wastedBytes: item.wastedBytes,
              strategy: label,
            });
      }
      return {
        reference: `F${String(index + 1).padStart(2, "0")}`,
        title: readable(first.title),
        category: first.category,
        severity: group.reduce(
          (level, finding) =>
            weight[finding.severity] < weight[level] ? finding.severity : level,
          first.severity,
        ),
        kind: first.kind,
        confidence: group.every((finding) => finding.confidence === "high")
          ? "high"
          : group.some((finding) => finding.confidence === "low")
            ? "low"
            : "medium",
        urls: [...new Set(group.map((finding) => finding.url))],
        ids: group.map((finding) => finding.id),
        ...detail,
        evidence: [...new Set(evidence)],
        resources: resources
          .sort((a, b) => (b.wastedBytes ?? 0) - (a.wastedBytes ?? 0))
          .filter(
            (item, index, all) =>
              all.findIndex((other) => other.url === item.url) === index,
          )
          .slice(0, 3),
      };
    });
}
