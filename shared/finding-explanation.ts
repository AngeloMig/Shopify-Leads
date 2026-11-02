import type { Finding, PsiSample } from "./types.js";
import type { ReportIssue } from "./audit-presentation.js";

const copy = [
  {
    match: /contrast/i,
    title: "Some text is difficult to read",
    meaning:
      "Some text does not stand out clearly enough from its background. This can make it difficult to read, especially for visitors with reduced vision.",
    action:
      "Adjust the text or background colour in the affected sections so the text is easier to read. Check the actual text size and weight before choosing the required contrast.",
    validation:
      "Recheck the affected text on mobile and desktop, then rerun the contrast check. Review the rest of the page manually as well.",
  },
  {
    match: /button.*name/i,
    title: "Some buttons do not explain what they do",
    meaning:
      "The automated check found buttons without an accessible name. People using a screen reader may not hear what those buttons do.",
    action:
      "Give each affected button a clear visible label or an accessible name that describes its action.",
    validation:
      "Check the buttons with a screen reader and keyboard, then rerun the accessibility check.",
  },
  {
    match: /link.*name/i,
    title: "Some links do not explain where they lead",
    meaning:
      "The automated check found links without a clear accessible name. People using a screen reader may not know their destination.",
    action:
      "Add descriptive link text or an accessible name to each affected link, including links that contain only an icon or image.",
    validation:
      "Check the affected links with a screen reader and keyboard, then rerun the accessibility check.",
  },
  {
    match: /unused javascript/i,
    title: "Unused JavaScript was downloaded",
    meaning:
      "The browser downloaded code that was not used during the tested page load. Some of that code may still be needed when a visitor interacts with the page.",
    action:
      "Review theme code and third-party apps. Delay optional features until they are needed, and remove unused code only after testing the affected features.",
    validation:
      "Repeat comparable mobile and desktop loading tests. Check navigation, the cart, consent controls and analytics still work correctly.",
  },
  {
    match: /unused css/i,
    title: "Unused styling code was downloaded",
    meaning:
      "The browser downloaded styling rules that were not used during the tested page load. Reviewing these files may reduce unnecessary downloads.",
    action:
      "Remove unused styling rules where safe, and load styles for optional features when needed. Check that changes do not alter the page layout.",
    validation:
      "Repeat the loading test and compare file sizes. Check the page appearance at mobile and desktop sizes.",
  },
  {
    match: /render.blocking/i,
    title: "Some files may delay the page appearing",
  },
  {
    match:
      /image delivery|optimized images|responsive images|properly size images/i,
    title: "Some images could load more efficiently",
    meaning:
      "The automated loading test found images that could use a smaller file size or a better size for the visitor’s screen.",
    action:
      "Use appropriately sized images and suitable compression. Keep the main visible image loading promptly, and delay images further down the page until needed.",
    validation:
      "Compare image download sizes and loading time on the same device settings. Check that images remain sharp and the page layout stays stable.",
  },
  {
    match: /images without alt/i,
    title: "Some images are missing text descriptions",
  },
  {
    match: /missing h1/i,
    title: "A page is missing its main heading",
    meaning:
      "No main heading was found in the saved page HTML. A clear main heading helps visitors understand what the page is about.",
    action:
      "Add a descriptive main heading and check that it fits the page’s heading structure.",
    validation:
      "Review the rendered page and its heading structure, then repeat the check.",
  },
  {
    match: /missing meta description/i,
    title: "A page is missing its search description",
    meaning:
      "No page description was found in the saved HTML. This short summary can help explain the page when it appears in search results.",
  },
  {
    match: /image dimensions/i,
    title: "Image space needs a layout check",
    meaning:
      "Some images have no width or height in the saved HTML. The site’s styling may already reserve their space, so a visual check is needed before calling this a layout problem.",
  },
];

/** Summarize only recorded diagnostic nodes; never render their HTML snippets. */
export function explainFinding(
  issue: ReportIssue,
  findings: Finding[],
  samples: PsiSample[],
) {
  const template = copy.find((entry) => entry.match.test(issue.title));
  const examples: {
    text: string;
    measurement?: string;
    page: string;
    device: string;
  }[] = [];
  for (const finding of findings.filter((entry) =>
    issue.ids.includes(entry.id),
  )) {
    const device = finding.evidence.match(/^Lighthouse (mobile|desktop) /)?.[1];
    const sample = samples.find(
      (entry) =>
        entry.sample === 1 &&
        entry.strategy === device &&
        entry.url === finding.url,
    );
    const diagnostic = Object.values(sample?.diagnostics ?? {}).find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry as { title?: string }).title === finding.title,
    ) as { details?: unknown } | undefined;
    let details = diagnostic?.details;
    if (!details && device) {
      try {
        // Older saved evidence can end mid-JSON; partial values are not guessed.
        const start = finding.evidence.indexOf(": ");
        if (start >= 0) details = JSON.parse(finding.evidence.slice(start + 2));
      } catch {
        /* Full saved diagnostics, when available, are used instead. */
      }
    }
    let visited = 0;
    const visit = (value: unknown, depth = 0) => {
      if (++visited > 250 || depth > 8 || !value || typeof value !== "object")
        return;
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, depth + 1));
        return;
      }
      const node = value as Record<string, unknown>;
      if (typeof node.nodeLabel === "string" && node.nodeLabel.trim()) {
        const label = node.nodeLabel.replace(/\s+/g, " ").trim().slice(0, 160);
        const selector = /(?: > |^[a-z][\w-]*[.#]|^<[a-z])/i.test(label);
        const text = selector
          ? /link.*name/i.test(issue.title)
            ? "A link without a readable label"
            : /button.*name/i.test(issue.title)
              ? "A button without a readable label"
              : "A flagged page element"
          : label;
        const ratio =
          typeof node.explanation === "string"
            ? node.explanation.match(
                /(?:contrast ratio of|color contrast of)\s+([\d.]+)[\s\S]*?Expected contrast ratio of\s+([\d.]+)/i,
              )
            : null;
        const measurement = ratio
          ? `Recorded contrast ${ratio[1]}:1; required for this text ${ratio[2]}:1.`
          : undefined;
        if (
          examples.length < 12 &&
          !examples.some(
            (example) =>
              example.text === text &&
              example.measurement === measurement &&
              example.page === finding.url,
          )
        )
          examples.push({
            text,
            measurement,
            page: finding.url,
            device:
              device === "mobile"
                ? "Mobile"
                : device === "desktop"
                  ? "Desktop"
                  : "Page inspection",
          });
      }
      Object.values(node).forEach((item) => visit(item, depth + 1));
    };
    visit(details);
  }
  return {
    title: template?.title ?? issue.title,
    meaning: template?.meaning ?? issue.meaning,
    action: template?.action ?? issue.action,
    validation: template?.validation ?? issue.validation,
    examples: examples
      .sort((a, b) => Number(!!b.measurement) - Number(!!a.measurement))
      .slice(0, 3),
  };
}
