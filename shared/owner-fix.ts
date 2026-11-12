// The report's first page speaks to the owner: for each fix, what it costs
// their store now, in their own measured numbers, and what changes after.
// Every number here comes from this check; nothing is borrowed from another
// store.
import { impactOrder, type ReportIssue } from "./audit-presentation.js";
import type { Finding } from "./types.js";

/** "your home page", "a product page": how an owner names a page. */
export function pageName(url: string) {
  let path = "/";
  try {
    path = new URL(url).pathname;
  } catch {
    /* An unreadable address is named generally. */
  }
  if (path === "/" || path === "") return "your home page";
  if (/\/products\//.test(path)) return "a product page";
  if (/\/collections\//.test(path)) return "a collection page";
  return "one of your pages";
}

/** 862500 → "860 KB", 1873000 → "1.9 MB": round, so it reads as an estimate. */
export function size(bytes: number) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 100_000) return `${Math.round(bytes / 10_000) * 10} KB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
/** 3140 → "3.1 seconds", 600 → "0.6 seconds". */
export const seconds = (ms: number) =>
  `${(Math.round(ms / 100) / 10).toFixed(1)} seconds`;

const files = (n: number) => (n === 1 ? "1 file" : `${n} files`);

/**
 * One sentence on what this costs the store now, from this check's own
 * numbers, or null when the check didn't measure one.
 */
export function ownerNow(issue: ReportIssue, findings: Finding[]) {
  const impact = issue.impact;
  const title = issue.title;
  if (impact && (impact.ms || impact.bytes)) {
    const page = pageName(impact.url);
    const wait =
      impact.ms && impact.ms >= 100
        ? `, which Google estimates adds about ${seconds(impact.ms)} on a phone`
        : "";
    const spread =
      impact.files > 1 ? `, spread over ${files(impact.files)}` : "";
    const amount = impact.bytes ? size(impact.bytes) : null;
    if (/unused javascript/i.test(title) && amount)
      return `On ${page}, phones download ${amount} of code that isn't used${spread}${wait}.`;
    if (/unused css/i.test(title) && amount)
      return `On ${page}, phones download ${amount} of styling that isn't used${spread}${wait}.`;
    if (/image/i.test(title) && amount)
      return `The images on ${page} are about ${amount} heavier than they need to be${wait}.`;
    if (/render.blocking/i.test(title) && impact.ms)
      return `On ${page}, a phone has to wait for ${impact.files > 1 ? files(impact.files) : "some files"} before it can show anything. Google estimates that adds about ${seconds(impact.ms)}.`;
    if (impact.ms && impact.ms >= 100)
      return `Google estimates fixing this saves about ${seconds(impact.ms)} on ${page} on a phone.`;
    if (amount)
      return `Fixing this saves phones about ${amount} of downloading on ${page}.`;
  }
  // Counted on the page itself: images with no description.
  if (/images without alt/i.test(title)) {
    let worst: { missing: number; total: number; url: string } | null = null;
    for (const finding of findings.filter((f) => issue.ids.includes(f.id))) {
      const m = finding.evidence.match(/^(\d+)\/(\d+) images have no alt/i);
      if (m && (!worst || Number(m[1]) > worst.missing))
        worst = {
          missing: Number(m[1]),
          total: Number(m[2]),
          url: finding.url,
        };
    }
    if (worst)
      return `${worst.missing} of the ${worst.total} images on ${pageName(worst.url)} have no description${issue.urls.length > 1 ? `, and we found the same on ${issue.urls.length - 1} more ${issue.urls.length === 2 ? "page" : "pages"}` : ""}.`;
  }
  return null;
}

/**
 * The fixes an owner should see first: the ones that measurably cost the
 * most time on a phone, then download size, then the rest in their order.
 */
export function ownerOrder<T extends ReportIssue>(issues: T[]) {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort(
      (a, b) =>
        impactOrder(a.issue.impact, b.issue.impact) || a.index - b.index,
    )
    .map(({ issue }) => issue);
}

/** The single biggest time saving among these fixes, if any was measured. */
export function biggestSaving(issues: ReportIssue[]) {
  const best = ownerOrder(issues)[0]?.impact;
  return best?.ms && best.ms >= 300 ? best : null;
}
