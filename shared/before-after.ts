// Before and after: the same public tests on two dates, for a client whose
// store you've worked on. Medians of three runs, as in the audit itself.
import { comparableRuns } from "./audit-presentation.js";
import type { Finding, PsiSample } from "./types.js";

export type AuditSnapshot = {
  tested_at: string;
  samples: PsiSample[];
  findings: Finding[];
};
export type ComparisonRow = {
  label: string;
  before: number | null;
  after: number | null;
  /** "score" is 0-100, higher is better; the rest are lower-is-better. */
  unit: "score" | "ms" | "cls";
  better: boolean | null;
};

const rowsFor = (s: PsiSample[]) => {
  const mobile = comparableRuns(s, "mobile"),
    desktop = comparableRuns(s, "desktop");
  return [
    ["Mobile performance", mobile.score("performance"), "score"],
    ["Desktop performance", desktop.score("performance"), "score"],
    ["Mobile SEO", mobile.score("seo"), "score"],
    ["Mobile accessibility", mobile.score("accessibility"), "score"],
    ["Mobile best practices", mobile.score("best-practices"), "score"],
    [
      "Largest content shown (mobile)",
      mobile.metric("largest-contentful-paint"),
      "ms",
    ],
    ["Time the page was blocked", mobile.metric("total-blocking-time"), "ms"],
    ["Layout shift", mobile.metric("cumulative-layout-shift"), "cls"],
  ] as const;
};

/** What a finding is, regardless of which audit found it. */
const key = (f: { title: string; category: string }) =>
  `${f.category}|${f.title}`.toLowerCase();

export function compareAudits(before: AuditSnapshot, after: AuditSnapshot) {
  const a = rowsFor(before.samples),
    b = rowsFor(after.samples);
  const rows: ComparisonRow[] = a.map(([label, was, unit], i) => {
    const now = b[i][1];
    return {
      label,
      before: was,
      after: now,
      unit,
      better:
        was === null || now === null || was === now
          ? null
          : unit === "score"
            ? now > was
            : now < was,
    };
  });
  const verified = (s: AuditSnapshot) =>
    s.findings.filter((f) => f.kind === "verified");
  const was = new Map(verified(before).map((f) => [key(f), f]));
  const now = new Map(verified(after).map((f) => [key(f), f]));
  return {
    rows,
    fixed: [...was].filter(([k]) => !now.has(k)).map(([, f]) => f),
    open: [...now].filter(([k]) => was.has(k)).map(([, f]) => f),
    added: [...now].filter(([k]) => !was.has(k)).map(([, f]) => f),
    /** Both sides need full, comparable test runs to compare scores at all. */
    measured: rows.some((r) => r.before !== null && r.after !== null),
  };
}

export const formatValue = (
  value: number | null,
  unit: ComparisonRow["unit"],
) =>
  value === null
    ? "Not measured"
    : unit === "score"
      ? `${Math.round(value)}`
      : unit === "ms"
        ? value >= 1000
          ? `${(value / 1000).toFixed(1)} s`
          : `${Math.round(value)} ms`
        : value.toFixed(2);
