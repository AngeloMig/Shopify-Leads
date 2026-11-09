// The audit report a store owner reads: plain words first, the evidence for
// their developer at the back. Every number comes from the saved audit, and
// every outside statistic names its source.
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
import { explainFinding } from "../../shared/finding-explanation.js";
import { shortBusinessName } from "../../shared/lead-intelligence.js";
import {
  matchingWork,
  offerLine,
  portfolioLabel,
  type Sender,
} from "../../shared/sender.js";
export const reportVersion = "v5";
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
  /** Who the report is from, for "What happens next". */
  sender?: Sender | null;
  /** The store's industry, to point to similar work. */
  industry?: string | null;
  /** The homepage as a phone showed it (PNG), when browser checks ran. */
  screenshot?: Buffer | null;
  screenshot_at?: string | null;
};

/**
 * Facts about shopping on a phone, each with its source, for the "why speed
 * matters" page. Kept to figures checked against the publisher.
 */
export const phoneFacts = [
  {
    big: "1 in 2",
    text: "More than half of all visits to websites now come from phones.",
    source: "StatCounter Global Stats, 2026",
  },
  {
    big: "3 in 4",
    text: "About three in four visits to online stores over the 2025 Black Friday weekend came from phones, and about two in three orders.",
    source: "Nosto, BFCM 2025 shopping data",
  },
  {
    big: "53%",
    text: "of visits to a mobile site are abandoned if it takes longer than 3 seconds to load.",
    source: "Google, mobile page speed research",
  },
  {
    big: "+113%",
    text: "As a page's load time goes from 1 to 7 seconds, the chance a phone visitor leaves without doing anything rises by 113%.",
    source: "Google, mobile page speed benchmarks",
  },
  {
    big: "+8.4%",
    text: "A mobile site just 0.1 seconds faster saw 8.4% more retail sales, and shoppers spent 9.2% more per order.",
    source: "Deloitte for Google, Milliseconds Make Millions",
  },
];

/** Google's own bands for its 0-100 scores. */
const band = (score: number | null, speed = false) =>
  score === null
    ? { word: "Not measured", color: "#716D65", pale: "#F2F0EB" }
    : score >= 90
      ? { word: "Good", color: "#2C7A4B", pale: "#E4F1E8" }
      : score >= 50
        ? { word: "Needs work", color: "#8A5708", pale: "#F7EBD3" }
        : {
            word: speed ? "Slow" : "Poor",
            color: "#B3402D",
            pale: "#F6E1DC",
          };
const priorityTag = {
  high: { word: "Fix first", color: "#B3402D", pale: "#F6E1DC" },
  medium: { word: "Worth fixing", color: "#8A5708", pale: "#F7EBD3" },
  low: { word: "Small fix", color: "#5D5A54", pale: "#F2F0EB" },
} as const;
const longDate = (date: string) => {
  const value = new Date(date);
  return Number.isNaN(value.getTime())
    ? readable(date)
    : value.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
};
/** "Home page", "Product page: linen-sheet", "/pages/faq". */
const pageName = (url: string) => {
  try {
    const path = new URL(url).pathname.replace(/\/$/, "");
    if (!path) return "Home page";
    const product = path.match(/\/products\/([^/]+)/);
    if (product) return `Product page: ${product[1]}`;
    const collection = path.match(/\/collections\/([^/]+)$/);
    if (collection) return `Collection page: ${collection[1]}`;
    return path;
  } catch {
    return url;
  }
};

/**
 * The store's own number on the "Why speed on a phone matters" page. It
 * agrees with page 1: when Google's phone test is slow but real visitors
 * are fast, the test leads and real visitors are named beside it, so the
 * card never argues against the report.
 */
export function phoneSpeedCard(lab: number | null, real: number | null) {
  const short = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const long = (ms: number) => `${(ms / 1000).toFixed(1)} seconds`;
  const target = 2500;
  if (lab === null && real === null)
    return {
      big: "Your store",
      text: "This check didn't record a reliable phone speed, so we can't compare it yet.",
      source: "Google PageSpeed Insights, this check",
    };
  if (real !== null && (real > target || lab === null || lab <= target))
    return {
      big: short(real),
      text: `How long 3 in 4 of your real phone visitors waited for the main content. ${real > target ? "Google's target is 2.5 seconds." : "That's within Google's 2.5-second target."}`,
      source: "Chrome UX Report for your site",
    };
  return {
    big: short(lab!),
    text: `How long the main content took to appear in Google's phone test, which acts like a mid-range phone on a slower connection. Google's target is 2.5 seconds.${real !== null ? ` Your real phone visitors see it sooner (3 in 4 within ${long(real)}), but shoppers on slower phones and networks wait closer to this.` : ""}`,
    source:
      real !== null
        ? "Google PageSpeed Insights, this check · Chrome UX Report"
        : "Google PageSpeed Insights, this check",
  };
}

export async function createReport(input: ReportInput): Promise<Buffer> {
  const M = 48,
    W = 499.28,
    bottom = 772;
  const ink = "#141414",
    muted = "#5D5A54",
    subtle = "#716D65",
    gold = "#B38A2E",
    goldDark = "#7A5C16",
    goldPale = "#F7EFDC",
    line = "#E5E2DA",
    paper = "#F7F6F2";
  const store = readable(shortBusinessName(input.name, input.domain));
  const from = readable(
    input.sender?.company || input.agency || input.sender?.name || "Scout",
  );
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 78, left: M, right: M, bottom: 64 },
    bufferPages: true,
    info: {
      Title: `${input.demo ? "SYNTHETIC DEMO - " : ""}${store} - website check-up`,
      Author: from,
      Subject: `How ${input.domain} is doing, from its public pages`,
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
  const toCheck = issues.filter((issue) => issue.kind !== "verified");
  const plain = (issue: (typeof issues)[number]) =>
    explainFinding(issue, input.findings, input.samples);
  const phoneScore = mobile.score("performance");
  const lcp = mobile.metric("largest-contentful-paint");
  // What real phone visitors saw (Chrome UX Report, 75th percentile), when
  // Google has enough visits to say. The lab test is a slow phone on a slow
  // connection, so both are named for what they are.
  const realLcp = (() => {
    const run = input.samples.find(
      (sample) =>
        sample.strategy === "mobile" &&
        sample.sample === 1 &&
        sample.field_data.available,
    );
    const value = (
      run?.field_data.metrics as
        | Record<string, { percentile?: number }>
        | undefined
    )?.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
    return typeof value === "number" ? value : null;
  })();
  const secs = (value: number) => `${(value / 1000).toFixed(1)} seconds`;

  const header = () => {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(goldDark)
      .text(from, M, 30, { width: 260, lineBreak: false });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(muted)
      .text(`Website check-up · ${input.domain}`, M + 260, 31, {
        width: W - 260,
        align: "right",
        lineBreak: false,
      });
    doc
      .moveTo(M, 52)
      .lineTo(M + W, 52)
      .strokeColor(line)
      .lineWidth(0.7)
      .stroke();
    doc.x = M;
    doc.y = 78;
    doc.font("Helvetica").fontSize(10).fillColor(ink);
  };
  header();
  doc.on("pageAdded", header);
  const ensure = (height: number) => {
    if (doc.y + Math.min(height, 680) > bottom) doc.addPage();
  };
  const text = (
    value: string,
    options: {
      size?: number;
      color?: string;
      bold?: boolean;
      gap?: number;
      x?: number;
      width?: number;
      after?: number;
    } = {},
  ) => {
    const copy = readable(value);
    const size = options.size ?? 10.5,
      width = options.width ?? W,
      x = options.x ?? M,
      gap = options.gap ?? 3.5;
    doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    ensure(doc.heightOfString(copy, { width, lineGap: gap }) + 6);
    doc
      .fillColor(options.color ?? ink)
      .text(copy, x, doc.y, { width, lineGap: gap });
    doc.y += options.after ?? 8;
  };
  const title = (value: string, size = 22) => {
    ensure(70);
    doc
      .font("Helvetica-Bold")
      .fontSize(size)
      .fillColor(ink)
      .text(readable(value), M, doc.y, { width: W, lineGap: 2 });
    doc.y += 8;
  };
  const section = (value: string) => {
    ensure(60);
    doc.y += 6;
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(ink)
      .text(readable(value), M, doc.y, { width: W });
    doc.y += 8;
  };
  /** A paragraph that opens with a bold lead-in: "Why it matters. Shoppers…" */
  const lead = (head: string, body: string, x: number, width: number) => {
    const copy = readable(body);
    doc.font("Helvetica").fontSize(10);
    ensure(doc.heightOfString(`${head} ${copy}`, { width, lineGap: 3 }) + 6);
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(ink)
      .text(`${head} `, x, doc.y, { width, lineGap: 3, continued: true })
      .font("Helvetica")
      .fillColor(ink)
      .text(copy, { width, lineGap: 3 });
    doc.y += 6;
  };
  /** A rounded tag such as "Fix first", drawn at (x, y); returns its width. */
  const pill = (
    word: string,
    x: number,
    y: number,
    tone: { color: string; pale: string },
  ) => {
    doc.font("Helvetica-Bold").fontSize(8.5);
    const w = doc.widthOfString(word) + 14;
    doc.roundedRect(x, y, w, 16, 4).fill(tone.pale);
    doc
      .fillColor(tone.color)
      .text(word, x + 7, y + 4, { width: w, lineBreak: false });
    return w;
  };
  const link = (value: string, url: string, size = 9) => {
    let href: string | undefined;
    try {
      if (["https:", "http:"].includes(new URL(url).protocol)) href = url;
    } catch {
      /* A plain label. */
    }
    const copy = readable(value);
    doc.font("Helvetica").fontSize(size);
    ensure(doc.heightOfString(copy, { width: W }) + 8);
    doc
      .fillColor(goldDark)
      .text(copy, M, doc.y, { width: W, link: href, lineGap: 2 });
    doc.y += 6;
  };
  /** Google's 0-100 scale in its three colours, with this store marked. */
  const gauge = (
    x: number,
    y: number,
    width: number,
    score: number | null,
    heading: string,
  ) => {
    const tone = band(score, true);
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(muted)
      .text(heading, x, y, { width, lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(26)
      .fillColor(tone.color)
      .text(score === null ? "-" : String(Math.round(score)), x, y + 14, {
        lineBreak: false,
      });
    const numberWidth = doc.widthOfString(
      score === null ? "-" : String(Math.round(score)),
    );
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(muted)
      .text("/ 100", x + numberWidth + 5, y + 27, { lineBreak: false });
    pill(tone.word, x + width - 74, y + 20, tone);
    const barY = y + 52;
    const segments: [number, number, string][] = [
      [0, 49, "#F0C9C0"],
      [50, 89, "#F1DDB3"],
      [90, 100, "#C9E4D2"],
    ];
    for (const [from, to, color] of segments)
      doc
        .rect(
          x + (from / 100) * width,
          barY,
          ((to - from + 1) / 100) * width,
          7,
        )
        .fill(color);
    if (score !== null) {
      const markX = x + (Math.min(100, Math.max(0, score)) / 100) * width;
      doc.circle(markX, barY + 3.5, 6).fill(tone.color);
      doc.circle(markX, barY + 3.5, 2.4).fill("#FFFFFF");
    }
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(subtle)
      .text("Slow", x, barY + 12, { lineBreak: false })
      .text("Needs work", x + width * 0.5, barY + 12, { lineBreak: false })
      .text("Good", x + width * 0.9, barY + 12, { lineBreak: false });
  };

  // ── Page 1: the short version ─────────────────────────────────────────
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(goldDark)
    .text(
      `WEBSITE CHECK-UP · ${longDate(input.date).toUpperCase()}`,
      M,
      doc.y,
      {
        width: W,
        characterSpacing: 0.6,
      },
    );
  doc.y += 8;
  title(`How ${store}'s website is doing`, 24);
  link(input.domain, `https://${input.domain}`, 11);
  if (input.demo)
    text(
      "SYNTHETIC DEMO - Fictional sample data. No live website was checked.",
      { size: 11, color: "#B3402D", bold: true },
    );
  doc.y += 4;

  const shortVersion = [
    phoneScore !== null
      ? `On a phone, Google rates your home page's speed ${Math.round(phoneScore)} out of 100, which it counts as ${band(phoneScore, true).word.toLowerCase()}.`
      : "We couldn't get a reliable phone speed score in this check.",
    lcp !== null
      ? `In Google's test, which acts like a mid-range phone on a slower connection, the main content took about ${secs(lcp)} to appear. Google recommends under 2.5 seconds.`
      : "",
    realLcp !== null
      ? `Real visitors see it sooner: 3 in 4 within ${secs(realLcp)}${realLcp > 2500 ? ", still over the target" : ""}.`
      : "",
    verified.length
      ? `We found ${verified.length} ${verified.length === 1 ? "thing" : "things"} worth fixing${toCheck.length ? `, and ${toCheck.length} more to check by hand` : ""}. The ones that matter most are below.`
      : "We didn't find anything clearly wrong in this check. That isn't a guarantee there's nothing to improve.",
  ]
    .filter(Boolean)
    .join(" ");
  doc.font("Helvetica").fontSize(11);
  const shortHeight =
    doc.heightOfString(readable(shortVersion), {
      width: W - 36,
      lineGap: 3,
    }) + 44;
  const boxY = doc.y;
  doc.roundedRect(M, boxY, W, shortHeight, 8).fill(goldPale);
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(goldDark)
    .text("The short version", M + 18, boxY + 16, { width: W - 36 });
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor(ink)
    .text(readable(shortVersion), M + 18, boxY + 33, {
      width: W - 36,
      lineGap: 3,
    });
  doc.y = boxY + shortHeight + 16;

  ensure(100);
  const gaugeY = doc.y;
  const half = (W - 28) / 2;
  gauge(M, gaugeY, half, phoneScore, "Speed on a phone");
  gauge(
    M + half + 28,
    gaugeY,
    half,
    desktop.score("performance"),
    "Speed on a computer",
  );
  doc.y = gaugeY + 72;

  section("Your scorecard");
  const rows: [string, string, number | null, boolean][] = [
    [
      "Speed on phones",
      "How quickly your pages load on mobile",
      phoneScore,
      true,
    ],
    [
      "Easy to find on Google",
      "The basics search engines look for",
      mobile.score("seo"),
      false,
    ],
    [
      "Easy for everyone to use",
      "Readable text, labelled buttons and links",
      mobile.score("accessibility"),
      false,
    ],
    [
      "Built to current standards",
      "Security and up-to-date web practices",
      mobile.score("best-practices"),
      false,
    ],
  ];
  for (const [name, meaning, score, speed] of rows) {
    ensure(32);
    const y = doc.y;
    doc
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .fillColor(ink)
      .text(name, M, y + 2, { width: 240, lineBreak: false });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(muted)
      .text(meaning, M, y + 16, { width: 300, lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(ink)
      .text(score === null ? "-" : `${Math.round(score)}`, M + 330, y + 6, {
        width: 60,
        align: "right",
        lineBreak: false,
      });
    pill(band(score, speed).word, M + W - 86, y + 6, band(score, speed));
    doc
      .moveTo(M, y + 30)
      .lineTo(M + W, y + 30)
      .strokeColor(line)
      .lineWidth(0.5)
      .stroke();
    doc.y = y + 32;
  }

  if (input.screenshot) {
    // What a shopper actually sees, before any numbers about it.
    const shotW = 170,
      shotH = Math.round((shotW * 844) / 390);
    ensure(shotH + 60);
    section("Your home page on a phone");
    const top = doc.y;
    try {
      doc.image(input.screenshot, M, top, { width: shotW, height: shotH });
      doc
        .roundedRect(M, top, shotW, shotH, 6)
        .strokeColor(line)
        .lineWidth(1)
        .stroke();
      doc
        .font("Helvetica")
        .fontSize(10.5)
        .fillColor(ink)
        .text(
          readable(
            `This is what a shopper saw when we opened ${input.domain} on a phone-sized screen (390 pixels wide)${input.screenshot_at ? ` on ${longDate(input.screenshot_at)}` : ""}: the first screen, before scrolling.`,
          ),
          M + shotW + 24,
          top,
          { width: W - shotW - 24, lineGap: 3 },
        );
      doc.moveDown(0.6);
      doc
        .fillColor(muted)
        .fontSize(9.5)
        .text(
          "Most of your visitors arrive on a phone, so this first screen is where they decide whether to stay.",
          M + shotW + 24,
          doc.y,
          { width: W - shotW - 24, lineGap: 3 },
        );
      doc.x = M;
      doc.y = top + shotH + 14;
    } catch {
      // A damaged image shouldn't stop the report; it simply goes without.
      doc.x = M;
      doc.y = top;
    }
  }
  section(verified.length ? "What to fix first" : "What we looked at");
  if (!verified.length)
    text(
      "Speed, search basics and ease of use on your public pages. Nothing stood out as clearly broken, so there's no list of fixes.",
      { color: muted },
    );
  verified.slice(0, 3).forEach((issue, i) => {
    const copy = plain(issue);
    doc.font("Helvetica").fontSize(9.5);
    ensure(
      22 +
        doc.heightOfString(readable(copy.why), {
          width: W - 30,
          lineGap: 2.5,
        }),
    );
    const y = doc.y;
    doc.circle(M + 10, y + 9, 10).fill(ink);
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#FFFFFF")
      .text(String(i + 1), M, y + 4.5, { width: 20, align: "center" });
    doc
      .font("Helvetica-Bold")
      .fontSize(11.5)
      .fillColor(ink)
      .text(readable(copy.title), M + 30, y + 3, { width: W - 130 });
    pill(
      priorityTag[issue.severity].word,
      M + W - 86,
      y + 2,
      priorityTag[issue.severity],
    );
    doc.y = Math.max(doc.y, y + 18) + 2;
    text(copy.why, {
      x: M + 30,
      width: W - 30,
      size: 9.5,
      color: muted,
      gap: 2.5,
      after: 6,
    });
  });
  doc.y += 4;
  text(
    "This check looks only at your store's public pages, the way a shopper sees them. Scores come from Google PageSpeed Insights and can move a little between tests. It doesn't predict sales.",
    { size: 8.5, color: subtle },
  );

  // ── Page 2: why phone speed matters ───────────────────────────────────
  doc.addPage();
  title("Why speed on a phone matters");
  text(
    "Most of your visitors are probably on a phone, and phone shoppers are the least patient. A few facts from the research:",
    { color: muted, after: 14 },
  );
  const cardW = (W - 16) / 2;
  const cardHeight = (fact: { text: string }) => {
    doc.font("Helvetica").fontSize(10);
    return (
      74 +
      doc.heightOfString(readable(fact.text), {
        width: cardW - 32,
        lineGap: 3,
      })
    );
  };
  // The store's own number takes the last slot, in black, so it reads as
  // the answer to the facts before it.
  const yours = {
    ...phoneSpeedCard(lcp, realLcp),
    dark: true,
  };
  const cards = [...phoneFacts.map((f) => ({ ...f, dark: false })), yours];
  // Two cards a row, each row as tall as its taller card.
  for (let i = 0; i < cards.length; i += 2) {
    const pair = cards.slice(i, i + 2);
    const h = Math.max(...pair.map(cardHeight));
    ensure(h + 14);
    const y = doc.y;
    pair.forEach((fact, col) => {
      const x = M + col * (cardW + 16);
      doc.roundedRect(x, y, cardW, h, 8).fill(fact.dark ? ink : paper);
      doc
        .font("Helvetica-Bold")
        .fontSize(22)
        .fillColor(fact.dark ? "#E8CD8C" : gold)
        .text(fact.big, x + 16, y + 14, {
          width: cardW - 32,
          lineBreak: false,
        });
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(fact.dark ? "#FFFFFF" : ink)
        .text(readable(fact.text), x + 16, y + 44, {
          width: cardW - 32,
          lineGap: 3,
        });
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(fact.dark ? "#AAA59A" : subtle)
        .text(`Source: ${readable(fact.source)}`, x + 16, y + h - 18, {
          width: cardW - 32,
          lineBreak: false,
        });
    });
    doc.y = y + h + 14;
  }
  text(
    "The fixes in this report are aimed at the first few seconds on a phone: what shoppers see first, and how soon they can use it.",
    { color: muted },
  );

  // ── What we found, in plain words ─────────────────────────────────────
  doc.addPage();
  title("What we found");
  text(
    "Each item says what we saw, why it matters to your customers and what we'd do about it. The technical detail for your developer is at the back.",
    { color: muted, after: 14 },
  );
  if (!issues.length)
    text("No issues were recorded in this check.", { color: muted });
  issues.forEach((issue, i) => {
    const copy = plain(issue);
    // The title and its first paragraph stay together; the rest may flow.
    ensure(95);
    const y = doc.y;
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(goldDark)
      .text(String(i + 1).padStart(2, "0"), M, y + 2, { lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(ink)
      .text(readable(copy.title), M + 26, y, { width: W - 130 });
    const tone =
      issue.kind === "verified"
        ? priorityTag[issue.severity]
        : { word: "Check by hand", color: "#5D5A54", pale: "#F2F0EB" };
    pill(tone.word, M + W - 92, y + 1, tone);
    doc.y = Math.max(doc.y, y + 18) + 6;
    const indent = M + 26,
      width = W - 26;
    lead("What we saw.", copy.meaning, indent, width);
    for (const example of copy.examples)
      text(
        `•  ${example.text}${example.measurement ? ` (${example.measurement})` : ""} - ${pageName(example.page)}`,
        { x: indent + 6, width: width - 6, size: 9, color: muted, after: 3 },
      );
    if (copy.examples.length) doc.y += 4;
    lead("Why it matters.", copy.why, indent, width);
    lead(
      issue.kind === "verified" ? "What we'd do." : "What to check.",
      copy.action,
      indent,
      width,
    );
    if (issue.urls.length)
      text(
        `Where: ${[...new Set(issue.urls.map(pageName))].slice(0, 3).join(", ")}${issue.urls.length > 3 ? ` and ${issue.urls.length - 3} more` : ""}`,
        { x: indent, width, size: 8.5, color: subtle },
      );
    doc
      .moveTo(M, doc.y + 2)
      .lineTo(M + W, doc.y + 2)
      .strokeColor(line)
      .lineWidth(0.5)
      .stroke();
    doc.y += 16;
  });

  // ── What happens next ─────────────────────────────────────────────────
  ensure(300);
  if (doc.y > 200) doc.y += 6;
  title("What happens next", 20);
  const offer = input.sender ? offerLine(input.sender) : "";
  const steps: [string, string][] = [
    offer
      ? [
          `Start with: ${offer}`,
          (input.sender?.offer_scope
            ? input.sender.offer_scope.replace(/([^.!?])$/, "$1.")
            : "") || "A small first step, agreed before any work starts.",
        ]
      : [
          "We talk it through",
          "A short call to go through this report and answer your questions. No obligation.",
        ],
    [
      "We fix it carefully",
      "Changes can be made on a copy of your theme first, so your live store isn't touched until you're happy.",
    ],
    [
      "We show you the difference",
      "We run the same tests again and send you the before and after.",
    ],
  ];
  steps.forEach(([head, body], i) => {
    ensure(46);
    const y = doc.y;
    doc.circle(M + 11, y + 9, 11).fill(goldPale);
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(goldDark)
      .text(String(i + 1), M, y + 4.5, { width: 22, align: "center" });
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(ink)
      .text(head, M + 34, y + 2, { width: W - 34 });
    doc.y += 2;
    text(body, { x: M + 34, width: W - 34, size: 10, color: muted });
  });
  const sender = input.sender;
  const similar = sender ? matchingWork(sender, input.industry ?? "") : null;
  {
    ensure(90);
    doc.y += 6;
    const y = doc.y;
    const lines = [
      [sender?.name, sender?.company].filter(Boolean).join(", ") || from,
      similar
        ? `Similar work: ${similar.title}, another ${similar.industry.toLowerCase()} store`
        : "",
    ].filter(Boolean);
    // How to reach you: each line is a link (mail, phone, calendar).
    const reach: { text: string; link: string }[] = [
      ...(sender?.email
        ? [{ text: sender.email, link: `mailto:${sender.email}` }]
        : []),
      ...(sender?.phone
        ? [
            {
              text: sender.phone,
              link: `tel:${sender.phone.replace(/[^\d+]/g, "")}`,
            },
          ]
        : []),
      ...(sender?.booking_url
        ? [
            {
              text: `Book a call: ${portfolioLabel(sender.booking_url)}`,
              link: sender.booking_url,
            },
          ]
        : []),
    ];
    const h =
      30 +
      lines.length * 16 +
      (sender?.portfolio_url ? 16 : 0) +
      reach.length * 16;
    doc.roundedRect(M, y, W, h, 8).fill(paper);
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(goldDark)
      .text("PREPARED BY", M + 18, y + 14, { characterSpacing: 0.4 });
    let ly = y + 28;
    for (const l of lines) {
      doc
        .font(l === lines[0] ? "Helvetica-Bold" : "Helvetica")
        .fontSize(10.5)
        .fillColor(ink)
        .text(readable(l), M + 18, ly, {
          width: W - 36,
          link: l === lines[0] ? undefined : similar?.url,
        });
      ly += 16;
    }
    if (sender?.portfolio_url)
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(goldDark)
        .text(
          `See our work: ${portfolioLabel(sender.portfolio_url)}`,
          M + 18,
          ly,
          { width: W - 36, link: sender.portfolio_url },
        );
    if (sender?.portfolio_url) ly += 16;
    for (const r of reach) {
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(goldDark)
        .text(readable(r.text), M + 18, ly, { width: W - 36, link: r.link });
      ly += 16;
    }
    doc.y = y + h + 12;
  }

  // ── For your developer ────────────────────────────────────────────────
  doc.addPage();
  title("For your developer", 18);
  text(
    "The measurements and evidence behind this report, for whoever looks after the site.",
    { color: muted, size: 9.5, after: 10 },
  );
  const table = (
    headers: string[],
    tableRows: string[][],
    widths: number[],
  ) => {
    const draw = (cells: string[], head: boolean) => {
      doc.font(head ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
      const height = Math.max(
        20,
        ...cells.map(
          (cell, index) =>
            doc.heightOfString(readable(cell), {
              width: widths[index] - 14,
              lineGap: 1.5,
            }) + 10,
        ),
      );
      if (doc.y + height > bottom) {
        doc.addPage();
        if (!head) draw(headers, true);
      }
      const y = doc.y;
      if (head) doc.rect(M, y, W, height).fill(paper);
      let x = M;
      cells.forEach((cell, index) => {
        doc
          .font(head ? "Helvetica-Bold" : "Helvetica")
          .fontSize(8.5)
          .fillColor(head ? goldDark : ink)
          .text(readable(cell), x + 7, y + 5, {
            width: widths[index] - 14,
            lineGap: 1.5,
          });
        x += widths[index];
      });
      doc
        .moveTo(M, y + height)
        .lineTo(M + W, y + height)
        .strokeColor(line)
        .lineWidth(0.4)
        .stroke();
      doc.y = y + height;
    };
    draw(headers, true);
    tableRows.forEach((row) => draw(row, false));
    doc.y += 10;
  };
  const score = (value: number | null) =>
    value === null ? "Unavailable" : `${Math.round(value)}/100`;
  const seconds = (value: number | null) =>
    value === null ? "Unavailable" : `${(value / 1000).toFixed(2)} s`;
  const ms = (value: number | null) =>
    value === null ? "Unavailable" : `${Math.round(value)} ms`;
  const stamp = (date: string) => {
    const value = new Date(date);
    return Number.isNaN(value.getTime())
      ? readable(date)
      : value
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d+Z$/, " UTC");
  };
  const small = (value: string, color = muted) =>
    text(value, { size: 8.5, color, gap: 2.5, after: 6 });
  const devSection = (value: string) => {
    ensure(50);
    doc.y += 6;
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(ink)
      .text(value, M, doc.y, { width: W });
    doc.y += 6;
  };
  devSection("Lighthouse scores (median of three runs)");
  table(
    ["Category", "Mobile", "Desktop"],
    [
      ["Performance", score(phoneScore), score(desktop.score("performance"))],
      ["SEO", score(mobile.score("seo")), score(desktop.score("seo"))],
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
    [W - 220, 110, 110],
  );
  devSection("Loading measurements (lab, median of three runs)");
  table(
    ["Measurement", "Mobile", "Desktop"],
    [
      [
        "Main content appears (Largest Contentful Paint)",
        seconds(lcp),
        seconds(desktop.metric("largest-contentful-paint")),
      ],
      [
        "Page stays steady (Cumulative Layout Shift)",
        mobile.metric("cumulative-layout-shift")?.toFixed(3) ?? "Unavailable",
        desktop.metric("cumulative-layout-shift")?.toFixed(3) ?? "Unavailable",
      ],
      [
        "Time the page is blocked (Total Blocking Time)",
        ms(mobile.metric("total-blocking-time")),
        ms(desktop.metric("total-blocking-time")),
      ],
    ],
    [W - 220, 110, 110],
  );
  small(
    "A median needs three runs of the same URL in the same Lighthouse setup. Lab values are not real-user Core Web Vitals; Total Blocking Time is not Interaction to Next Paint.",
    subtle,
  );
  const fieldRun = (strategy: "mobile" | "desktop") =>
    input.samples.find(
      (sample) =>
        sample.strategy === strategy &&
        sample.sample === 1 &&
        sample.field_data.available,
    );
  devSection("Real-user data (Chrome UX Report)");
  for (const strategy of ["mobile", "desktop"] as const) {
    const run = fieldRun(strategy);
    if (!run) {
      small(
        `${strategy === "mobile" ? "Mobile" : "Desktop"}: not available for this store. Real-user LCP, CLS and INP are unknown.`,
      );
      continue;
    }
    const metrics = run.field_data.metrics as Record<
      string,
      { percentile?: number; category?: string }
    >;
    const fieldLcp = metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
    const inp = (
      metrics.INTERACTION_TO_NEXT_PAINT ?? metrics.INTERACTION_TO_NEXT_PAINT_MS
    )?.percentile;
    const cls = metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.category;
    small(
      `${strategy === "mobile" ? "Mobile" : "Desktop"} (${run.field_data.scope === "origin" ? "whole site" : "this page"}, 75th percentile): LCP ${typeof fieldLcp === "number" ? `${(fieldLcp / 1000).toFixed(2)} s` : "unavailable"}, INP ${typeof inp === "number" ? `${Math.round(inp)} ms` : "unavailable"}, CLS ${cls?.replaceAll("_", " ").toLowerCase() ?? "unavailable"}. Targets: LCP 2.5 s or less, INP 200 ms or less, CLS 0.1 or less.`,
    );
  }
  devSection("Test runs");
  table(
    ["Device / run", "Fetched (UTC)", "Performance"],
    input.samples.map((sample) => [
      `${sample.strategy} / ${sample.sample}`,
      stamp(sample.tested_at),
      typeof sample.scores.performance !== "number"
        ? "Unavailable"
        : `${sample.scores.performance}/100`,
    ]),
    [110, W - 220, 110],
  );
  if (!input.samples.length) small("No performance runs were saved.");
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
        `${name}: ${result.runs.length} runs, ${result.distinctTimes} distinct fetch time(s)`,
    );
  if (reused.length)
    small(
      `Cached results: ${reused.join("; ")}. These medians come from returned responses, not independent fresh runs.`,
      "#8A5708",
    );
  small(
    `Lighthouse ${[...new Set(input.samples.map((s) => s.environment?.lighthouse_version).filter(Boolean))].join(", ") || "version not recorded"}; throttling ${[...new Set(input.samples.map((s) => s.environment?.throttling_method).filter(Boolean))].join(", ") || "not recorded"}.`,
    subtle,
  );

  devSection("Evidence for each item");
  issues.forEach((issue, i) => {
    ensure(50);
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .fillColor(ink)
      .text(
        `${String(i + 1).padStart(2, "0")}  ${readable(issue.title)}`,
        M,
        doc.y,
        { width: W },
      );
    doc.y += 3;
    small(
      `${issue.category} · ${issue.severity} priority · ${issue.kind === "verified" ? "verified" : "needs manual verification"} · ${issue.confidence} confidence · suggested service: ${issue.service}`,
      subtle,
    );
    for (const observation of issue.evidence) small(observation);
    for (const resource of issue.resources.slice(0, 6)) {
      let name = resource.url;
      try {
        const parsed = new URL(name);
        name = `${parsed.hostname}${parsed.pathname}`;
      } catch {
        /* Keep the observed label. */
      }
      link(
        `${resource.strategy}${typeof resource.wastedBytes === "number" ? ` · ${bytes(resource.wastedBytes)} possible saving` : ""}: ${name.length > 100 ? `${name.slice(0, 97)}...` : name}`,
        resource.url,
        8,
      );
    }
    small(`To confirm a fix: ${issue.validation}`);
    small(`Observation IDs: ${issue.ids.join(", ")}`, subtle);
    doc.y += 4;
  });
  for (const recommendation of input.recommendations) {
    if (
      !recommendation.finding_ids.length ||
      !recommendation.finding_ids.every((id) =>
        input.findings.some((finding) => finding.id === id),
      )
    )
      continue;
    small(
      `${recommendation.service}: ${recommendation.improvement} Possible impact (not measured): ${recommendation.potential_impact}. Difficulty: ${recommendation.difficulty}.`,
    );
  }

  devSection("What was checked");
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
      8.5,
    );
  if (!pages.length) small("No page list was saved for this check.");
  for (const skipped of input.page_limitations ?? [])
    small(`Not checked (${skipped.kind}): ${skipped.url}. ${skipped.reason}.`);
  small(
    `Technologies seen on public pages: ${input.technologies.join(", ") || "none recorded"}. ${input.country ? `Country: ${input.country_evidence || input.country}.` : ""} Audit ${stamp(input.date)}${input.audit_id ? `, reference ${input.audit_id.slice(0, 8)}` : ""}.`,
  );
  small(
    `Limits: tests cover the pages listed, not every product, collection or checkout step. Automated SEO and accessibility scores are not full manual audits. Private theme code, app settings, analytics and sales data were not accessed. ${input.history} Lighthouse savings are estimates, and mobile and desktop estimates should not be added together.`,
    subtle,
  );
  small("Sources for the facts on page 2:", subtle);
  for (const fact of phoneFacts) small(`· ${fact.source}`, subtle);
  link(
    "Methodology: About Google PageSpeed Insights",
    "https://developers.google.com/speed/docs/insights/v5/about",
    8.5,
  );

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .moveTo(M, 800)
      .lineTo(M + W, 800)
      .strokeColor(line)
      .lineWidth(0.5)
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(subtle)
      .text(
        `${input.demo ? "SYNTHETIC DEMO · " : ""}${store} · prepared by ${from}`,
        M,
        810,
        { width: W - 60, lineBreak: false },
      );
    doc.text(`${index + 1} / ${range.count}`, M + W - 50, 810, {
      width: 50,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = oldBottom;
  }
  doc.end();
  return finished;
}
