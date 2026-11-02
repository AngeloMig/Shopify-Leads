import PDFDocument from "pdfkit";
import type {
  Finding,
  Recommendation,
  PublicEmail,
} from "../../shared/types.js";
import type { PsiSample } from "./providers.js";
import {
  comparableRuns,
  readable,
  reportIssues,
  bytes,
} from "./report-data.js";
export const reportVersion = "v2";
export const reportAgency = (fallback: string) =>
  process.env.AGENCY_NAME?.trim() &&
  !/^your shopify agency$/i.test(process.env.AGENCY_NAME.trim())
    ? process.env.AGENCY_NAME.trim()
    : fallback;
export type ReportInput = {
  name: string;
  domain: string;
  date: string;
  findings: Finding[];
  samples: PsiSample[];
  recommendations: Recommendation[];
  activity: number | null;
  priority: number;
  modernization: number | null;
  technologies: string[];
  history: string;
  agency?: string;
  demo?: boolean;
  audit_id?: string;
  country?: string | null;
  country_evidence?: string | null;
  contacts?: PublicEmail[];
  pages?: { url: string; kind: string; status_code?: number | null }[];
  page_limitations?: { url: string; kind: string; reason: string }[];
};
export async function createReport(input: ReportInput): Promise<Buffer> {
  const M = 44,
    W = 507.28,
    bottom = 778;
  const ink = "#152D31",
    muted = "#526568",
    teal = "#08686D",
    line = "#D8E3E3",
    pale = "#EFF6F6";
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 82, left: M, right: M, bottom: 64 },
    bufferPages: true,
    info: {
      Title: `${input.demo ? "SYNTHETIC DEMO - " : ""}${input.domain} - Shopify website audit`,
      Author: input.agency || "Scout",
      Subject: "Evidence-based public storefront review",
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const issues = reportIssues(input.findings, input.samples);
  const mobile = comparableRuns(input.samples, "mobile"),
    desktop = comparableRuns(input.samples, "desktop");
  const verified = issues.filter((issue) => issue.kind === "verified");
  const header = () => {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(teal)
      .text(readable(input.agency || "Scout"), M, 30, {
        width: 220,
        lineBreak: false,
      });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(muted)
      .text(input.domain, M + 225, 31, {
        width: W - 225,
        align: "right",
        lineBreak: false,
      });
    doc
      .moveTo(M, 55)
      .lineTo(M + W, 55)
      .strokeColor(line)
      .lineWidth(0.7)
      .stroke();
    doc.x = M;
    doc.y = 82;
    doc.font("Helvetica").fontSize(10).fillColor(ink);
  };
  header();
  doc.on("pageAdded", header);
  const ensure = (height: number) => {
    if (doc.y + Math.min(height, 680) > bottom) doc.addPage();
  };
  const paragraph = (value: string, size = 10, color = ink) => {
    const copy = readable(value);
    doc.font("Helvetica").fontSize(size);
    ensure(doc.heightOfString(copy, { width: W, lineGap: 3 }) + 10);
    doc
      .font("Helvetica")
      .fontSize(size)
      .fillColor(color)
      .text(copy, M, doc.y, { width: W, lineGap: 3 });
    doc.y += 9;
  };
  const heading = (title: string) => {
    ensure(55);
    doc.y += 12;
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(teal)
      .text(title, M, doc.y, { width: W });
    doc.y += 10;
  };
  const page = (title: string, subtitle: string) => {
    doc.addPage();
    doc
      .font("Helvetica-Bold")
      .fontSize(25)
      .fillColor(ink)
      .text(title, M, doc.y, { width: W });
    doc.y += 10;
    paragraph(subtitle, 10, muted);
  };
  const link = (label: string, url: string, size = 9) => {
    let href: string | undefined;
    try {
      if (["https:", "http:"].includes(new URL(url).protocol)) href = url;
    } catch {
      /* Plain evidence label. */
    }
    doc.font("Helvetica").fontSize(size);
    const copy = readable(label);
    ensure(doc.heightOfString(copy, { width: W }) + 9);
    doc
      .fillColor(teal)
      .text(copy, M, doc.y, { width: W, link: href, lineGap: 2 });
    doc.y += 7;
  };
  const table = (
    headers: string[],
    rows: string[][],
    widths: number[],
    compact = false,
  ) => {
    const draw = (cells: string[], isHeader: boolean) => {
      doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      const height = Math.max(
        compact ? 22 : 30,
        ...cells.map(
          (cell, index) =>
            doc.heightOfString(readable(cell), {
              width: widths[index] - 18,
              lineGap: 2,
            }) + (compact ? 10 : 16),
        ),
      );
      if (doc.y + height > bottom) {
        doc.addPage();
        if (!isHeader) draw(headers, true);
      }
      const y = doc.y;
      if (isHeader) doc.rect(M, y, W, height).fill(pale);
      let x = M;
      cells.forEach((cell, index) => {
        doc
          .font(isHeader ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .fillColor(isHeader ? teal : ink)
          .text(readable(cell), x + 9, y + (compact ? 5 : 8), {
            width: widths[index] - 18,
            lineGap: 2,
          });
        x += widths[index];
      });
      doc
        .moveTo(M, y + height)
        .lineTo(M + W, y + height)
        .strokeColor(line)
        .lineWidth(0.5)
        .stroke();
      doc.y = y + height;
    };
    draw(headers, true);
    rows.forEach((row) => draw(row, false));
    doc.y += 12;
  };
  const score = (value: number | null) =>
    value === null ? "Unavailable" : `${Math.round(value)} / 100`;
  const seconds = (value: number | null) =>
    value === null ? "Unavailable" : `${(value / 1000).toFixed(2)} s`;
  const stamp = (date: string) => {
    const value = new Date(date);
    return Number.isNaN(value.getTime())
      ? readable(date)
      : value
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d+Z$/, " UTC");
  };

  doc
    .font("Helvetica-Bold")
    .fontSize(30)
    .fillColor(ink)
    .text("Shopify website audit", M, doc.y, { width: W });
  doc.y += 15;
  paragraph(input.name, 15);
  link(`https://${input.domain}`, `https://${input.domain}`, 12);
  paragraph(
    `Audit recorded: ${stamp(input.date)}${input.audit_id ? ` | Reference: ${input.audit_id.slice(0, 8)}` : ""}`,
    9,
    muted,
  );
  if (input.demo)
    paragraph(
      "SYNTHETIC DEMO - Fictional sample data. No live website was audited.",
      11,
      "#9D3C2D",
    );
  heading("What the evidence says");
  paragraph(
    verified.length
      ? `The saved audit supports ${verified.length} improvement area${verified.length === 1 ? "" : "s"}${issues.length > verified.length ? ` and ${issues.length - verified.length} item(s) needing manual verification` : ""}. ${mobile.score("performance") === null ? "A comparable three-response mobile score is unavailable." : `Mobile performance has a median Lighthouse score of ${Math.round(mobile.score("performance")!)}/100.`} Start with the supported findings below and validate changes before a production release.`
      : "No verified improvement areas are supported by the saved findings. Missing data and untested behavior remain unknown; this is not a certification that the website has no issues.",
  );
  table(
    ["Lighthouse category", "Mobile median", "Desktop median"],
    [
      [
        "Performance",
        score(mobile.score("performance")),
        score(desktop.score("performance")),
      ],
      [
        "Technical SEO",
        score(mobile.score("seo")),
        score(desktop.score("seo")),
      ],
      [
        "Accessibility",
        score(mobile.score("accessibility")),
        score(desktop.score("accessibility")),
      ],
      [
        "Best practices",
        score(mobile.score("best-practices")),
        score(desktop.score("best-practices")),
      ],
    ],
    [235, 136, W - 371],
  );
  paragraph(
    "Each median requires three responses with the same recorded URL and Lighthouse environment. Scores are automated checks of the tested page, not site-wide rankings, accessibility certification or conversion measurements.",
    9,
    muted,
  );
  heading("Recommended starting points");
  if (!verified.length)
    paragraph(
      "Collect sufficient evidence before proposing implementation work.",
    );
  for (const issue of verified.slice(0, 3)) {
    ensure(55);
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(ink)
      .text(`${issue.reference}  ${issue.title}`, M, doc.y, { width: W });
    doc.y += 5;
    paragraph(issue.service, 10, muted);
  }
  paragraph(
    "This review uses public storefront evidence. No financial uplift, revenue, sales volume or private Shopify configuration is inferred.",
    9,
    muted,
  );

  page(
    "Performance and real-user data",
    "Loading, stability and responsiveness are different measurements. Lab results and real-user data are kept separate.",
  );
  heading("Lab measurements: three-response medians");
  table(
    ["Metric", "Mobile", "Desktop"],
    [
      [
        "Largest Contentful Paint (LCP)",
        seconds(mobile.metric("largest-contentful-paint")),
        seconds(desktop.metric("largest-contentful-paint")),
      ],
      [
        "Cumulative Layout Shift (CLS)",
        mobile.metric("cumulative-layout-shift")?.toFixed(3) ?? "Unavailable",
        desktop.metric("cumulative-layout-shift")?.toFixed(3) ?? "Unavailable",
      ],
      [
        "Total Blocking Time (TBT)",
        mobile.metric("total-blocking-time") === null
          ? "Unavailable"
          : `${Math.round(mobile.metric("total-blocking-time")!)} ms`,
        desktop.metric("total-blocking-time") === null
          ? "Unavailable"
          : `${Math.round(desktop.metric("total-blocking-time")!)} ms`,
      ],
    ],
    [235, 136, W - 371],
  );
  paragraph(
    "LCP describes when the main content appears. CLS measures visible layout movement. TBT describes blocking during a lab load; it is not Interaction to Next Paint (INP). These lab values do not establish a real-user Core Web Vitals pass.",
    9,
    muted,
  );
  heading("Real-user experience (CrUX)");
  const fieldAvailable = input.samples.some(
    (sample) => sample.sample === 1 && sample.field_data.available,
  );
  if (!fieldAvailable)
    paragraph(
      "Mobile and desktop: real-user data is unavailable in the saved responses. Field LCP, CLS and INP remain unknown.",
      9,
    );
  if (fieldAvailable)
    for (const strategy of ["mobile", "desktop"] as const) {
      const run = input.samples.find(
        (sample) => sample.strategy === strategy && sample.sample === 1,
      );
      if (!run?.field_data.available) {
        paragraph(
          `${strategy === "mobile" ? "Mobile" : "Desktop"}: unavailable in the saved response. Real-user LCP, CLS and INP remain unknown.`,
          10,
        );
        continue;
      }
      const metrics = run.field_data.metrics as Record<
        string,
        { percentile?: number; category?: string }
      >;
      const lcp = metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
      const inp = (
        metrics.INTERACTION_TO_NEXT_PAINT ??
        metrics.INTERACTION_TO_NEXT_PAINT_MS
      )?.percentile;
      const cls = metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.category;
      paragraph(
        `${strategy === "mobile" ? "Mobile" : "Desktop"}: ${run.field_data.scope === "origin" ? "origin-wide" : "page-level"} field data. LCP (75th percentile): ${typeof lcp === "number" ? `${(lcp / 1000).toFixed(2)} s` : "unavailable"}; INP (75th percentile): ${typeof inp === "number" ? `${Math.round(inp)} ms` : "unavailable"}; CLS classification: ${cls?.replaceAll("_", " ").toLowerCase() ?? "unavailable"}.`,
      );
    }
  paragraph(
    "Real-user targets (75th percentile): LCP <=2.5 s, INP <=200 ms, CLS <=0.1. Origin-wide data covers the origin, not this page alone; field data is not a fresh lab test.",
    9,
    muted,
  );
  link(
    "Reference: Google's Core Web Vitals guidance",
    "https://web.dev/articles/vitals",
  );
  heading("Recorded responses and repeatability");
  table(
    ["Device / sample", "Lighthouse fetch time (UTC)", "Performance"],
    input.samples.map((sample) => [
      `${sample.strategy} / ${sample.sample}`,
      stamp(sample.tested_at),
      typeof sample.scores.performance !== "number"
        ? "Unavailable"
        : `${sample.scores.performance}/100`,
    ]),
    [110, 283, W - 393],
    true,
  );
  if (!input.samples.length) paragraph("No performance responses were saved.");
  const reused = (
    [
      ["Mobile", mobile],
      ["Desktop", desktop],
    ] as const
  )
    .filter(
      ([, result]) =>
        result.runs.length && result.distinctTimes < result.runs.length,
    )
    .map(
      ([name, result]) =>
        `${name}: ${result.runs.length} responses, ${result.distinctTimes} distinct fetch time(s)`,
    );
  if (reused.length)
    paragraph(
      `Cached-result caveat - ${reused.join("; ")}. These are returned-response medians, not independent fresh Lighthouse runs.`,
      9,
      "#825617",
    );
  paragraph(
    `Saved Lighthouse version(s): ${[...new Set(input.samples.map((sample) => sample.environment?.lighthouse_version).filter(Boolean))].join(", ") || "not recorded"}. Throttling method(s): ${[...new Set(input.samples.map((sample) => sample.environment?.throttling_method).filter(Boolean))].join(", ") || "not recorded"}.`,
    9,
    muted,
  );

  page(
    "Findings and supporting evidence",
    "Repeated mobile and desktop observations are grouped into one issue. Estimates are shown by device and are not added together.",
  );
  if (!issues.length)
    paragraph("No supported findings are recorded in this audit.");
  const measure = (text: string, size: number, gap = 3, bold = false) =>
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(size)
      .heightOfString(readable(text), { width: W, lineGap: gap });
  const resourceLabel = (
    resource: (typeof issues)[number]["resources"][number],
  ) => {
    let label = resource.url;
    try {
      const parsed = new URL(label);
      label = `${parsed.hostname}${parsed.pathname}`;
    } catch {
      /* Keep the observed label. */
    }
    return `${resource.strategy}${typeof resource.wastedBytes === "number" ? ` - ${bytes(resource.wastedBytes)}` : ""}: ${label.length > 110 ? `${label.slice(0, 107)}...` : label}`;
  };
  for (const issue of issues) {
    const tag = `${issue.category} | ${issue.severity} priority | ${issue.kind === "verified" ? "Verified observation" : "Manual verification needed"} | ${issue.confidence} confidence`;
    const resourceIntro =
      "Flagged resources (examples, not a combined savings total):";
    const issueHeight =
      measure(`${issue.reference}  ${issue.title}`, 16, 0, true) +
      7 +
      measure(tag, 9) +
      9 +
      measure(issue.meaning, 10) +
      9 +
      issue.evidence.reduce(
        (height, text) => height + measure(text, 9) + 9,
        0,
      ) +
      (issue.resources.length
        ? measure(resourceIntro, 9) +
          9 +
          issue.resources.reduce(
            (height, resource) =>
              height + measure(resourceLabel(resource), 8.5, 2) + 7,
            0,
          )
        : 0) +
      measure(`Recommended change: ${issue.action}`, 10) +
      9 +
      issue.urls.reduce(
        (height, url) => height + measure(`Affected page: ${url}`, 9, 2) + 7,
        0,
      ) +
      measure(
        `Evidence reference: ${issue.reference}. Original observation IDs are listed in the appendix.`,
        8.5,
      ) +
      27;
    // Keep a useful introduction together; long evidence may flow naturally
    // rather than reserving a large, mostly empty block on the previous page.
    ensure(Math.min(issueHeight, 200));
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor(teal)
      .text(`${issue.reference}  ${issue.title}`, M, doc.y, { width: W });
    doc.y += 7;
    paragraph(
      `${issue.category} | ${issue.severity} priority | ${issue.kind === "verified" ? "Verified observation" : "Manual verification needed"} | ${issue.confidence} confidence`,
      9,
      muted,
    );
    paragraph(issue.meaning);
    for (const observation of issue.evidence) paragraph(observation, 9);
    if (issue.resources.length) {
      paragraph(resourceIntro, 9, muted);
      for (const resource of issue.resources) {
        link(resourceLabel(resource), resource.url, 8.5);
      }
    }
    paragraph(`Recommended change: ${issue.action}`);
    for (const url of issue.urls) link(`Affected page: ${url}`, url);
    paragraph(
      `Evidence reference: ${issue.reference}. Original observation IDs are listed in the appendix.`,
      8.5,
      muted,
    );
    doc
      .moveTo(M, doc.y)
      .lineTo(M + W, doc.y)
      .strokeColor(line)
      .lineWidth(0.5)
      .stroke();
    doc.y += 18;
  }

  page(
    "Action plan and audit scope",
    "Use this as a scoped implementation brief. Validate evidence, test changes in a theme preview, and agree a release plan with the merchant.",
  );
  for (const issue of issues) {
    ensure(78);
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(teal)
      .text(
        `${issue.reference}  ${issue.kind === "verified" ? issue.service : "Verify before implementation"}`,
        M,
        doc.y,
        { width: W },
      );
    doc.y += 7;
    if (issue.kind !== "verified")
      paragraph(
        "Confirm this observation before agreeing implementation scope.",
        9,
        muted,
      );
    paragraph(`Acceptance check: ${issue.validation}`, 9, muted);
  }
  if (!issues.length)
    paragraph(
      "No implementation scope is proposed without supporting evidence.",
    );
  for (const recommendation of input.recommendations) {
    if (
      !recommendation.finding_ids.length ||
      !recommendation.finding_ids.every((id) =>
        input.findings.some((finding) => finding.id === id),
      )
    )
      continue;
    heading("Additional evidence-linked recommendation");
    paragraph(`${recommendation.service}: ${recommendation.improvement}`);
    paragraph(
      `Potential impact (not a measured outcome): ${recommendation.potential_impact}. Difficulty: ${recommendation.difficulty}. Merchant access ${recommendation.merchant_access_required ? "required" : "may still be needed for implementation"}.`,
      9,
      muted,
    );
  }
  heading("What was checked");
  const pages = input.pages?.length
    ? input.pages
    : [...new Set(input.findings.map((finding) => finding.url))].map((url) => ({
        url,
        kind: "Finding source",
        status_code: null,
      }));
  for (const source of pages)
    link(
      `${source.kind}${source.status_code ? ` (HTTP ${source.status_code})` : ""}: ${source.url}`,
      source.url,
      9,
    );
  if (!pages.length)
    paragraph("No page inventory is available in the saved evidence.", 9);
  paragraph(
    `Publicly detected technologies: ${input.technologies.join(", ") || "none recorded"}. ${input.country ? `Business country evidence: ${input.country_evidence || input.country}.` : "Business country not recorded."}`,
    9,
    muted,
  );
  if (input.contacts?.length)
    paragraph(
      `Published business email(s): ${input.contacts.map((contact) => contact.email).join(", ")}. Mailbox deliverability has not been checked.`,
      9,
      muted,
    );
  heading("Limits and next validation");
  for (const skipped of input.page_limitations ?? [])
    paragraph(
      `Not checked (${skipped.kind}): ${skipped.url}. ${skipped.reason}. No finding is inferred for this page.`,
      9,
      muted,
    );
  paragraph(
    `Performance tests cover the recorded URLs, not every collection, product or checkout step. Automated SEO and accessibility scores are not complete manual audits. Private Liquid source, app settings, CRM flows, analytics, sales and customer records were not accessed. ${input.history} Design age, private theme age and financial outcomes are not inferred.`,
    9,
    muted,
  );
  paragraph(
    "Implementation requires merchant-authorized access, regression testing and a repeat measurement under comparable conditions. Lighthouse savings are modeled opportunities, not guaranteed time savings. Device estimates and overlapping diagnostics must not be summed.",
    9,
    muted,
  );
  heading("Evidence appendix");
  for (const issue of issues)
    paragraph(`${issue.reference}: ${issue.ids.join(", ")}`, 8, muted);
  paragraph(
    "Original observations and saved diagnostics remain available in Scout.",
    9,
    muted,
  );
  link(
    "Methodology: About Google PageSpeed Insights",
    "https://developers.google.com/speed/docs/insights/v5/about",
  );

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .moveTo(M, 802)
      .lineTo(M + W, 802)
      .strokeColor(line)
      .lineWidth(0.5)
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(muted)
      .text(
        `${input.demo ? "SYNTHETIC DEMO | " : ""}${input.domain} | Public storefront review`,
        M,
        812,
        { width: W - 60, lineBreak: false },
      );
    doc.text(`${index + 1} / ${range.count}`, M + W - 50, 812, {
      width: 50,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = oldBottom;
  }
  doc.end();
  return finished;
}
