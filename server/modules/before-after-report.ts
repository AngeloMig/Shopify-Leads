import PDFDocument from "pdfkit";
import { readable, reportIssues } from "../../shared/audit-presentation.js";
import type { Finding } from "../../shared/types.js";
import { explainFinding } from "../../shared/finding-explanation.js";
import { shortBusinessName } from "../../shared/lead-intelligence.js";
import {
  compareAudits,
  formatValue,
  type AuditSnapshot,
} from "../../shared/before-after.js";
import {
  contactLines,
  portfolioLabel,
  type Sender,
} from "../../shared/sender.js";

export type BeforeAfterInput = {
  name: string;
  domain: string;
  sender: Sender;
  agency: string;
  before: AuditSnapshot;
  after: AuditSnapshot;
};
const day = (at: string) =>
  new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(at));

/** A short PDF for a client: what the same tests showed before and after. */
export async function createBeforeAfterReport(
  input: BeforeAfterInput,
): Promise<Buffer> {
  const M = 48,
    W = 499.28;
  const ink = "#141414",
    muted = "#5D5A54",
    goldDark = "#7A5C16",
    good = "#2F6B3A",
    bad = "#9A3B2E",
    line = "#E5E2DA",
    paper = "#F7F6F2";
  const store = readable(shortBusinessName(input.name, input.domain));
  const from = readable(input.sender.company || input.agency || "Scout");
  const result = compareAudits(input.before, input.after);
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 78, left: M, right: M, bottom: 64 },
    info: {
      Title: `${store} - before and after`,
      Author: from,
      Subject: `What changed on ${input.domain}`,
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
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
      .text(`Before and after · ${input.domain}`, M + 260, 31, {
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
  };
  header();
  doc.on("pageAdded", header);
  const ensure = (h: number) => {
    if (doc.y + h > 772) doc.addPage();
  };
  const text = (value: string, size = 10.5, color = ink, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    const copy = readable(value);
    ensure(doc.heightOfString(copy, { width: W, lineGap: 3 }) + 6);
    doc.fillColor(color).text(copy, M, doc.y, { width: W, lineGap: 3 });
    doc.y += 8;
  };

  doc
    .font("Helvetica-Bold")
    .fontSize(24)
    .fillColor(ink)
    .text(`What changed on ${store}`, M, doc.y, { width: W });
  doc.y += 10;
  text(
    `We ran the same public Google PageSpeed tests on ${day(input.before.tested_at)} and again on ${day(input.after.tested_at)}: three runs on mobile and three on desktop each time. Each number is the middle of the three runs.`,
    10.5,
    muted,
  );

  // The table: measure, before, after.
  doc.y += 4;
  const cols = [M, M + 250, M + 335, M + 420];
  const row = (cells: string[], y: number, bold = false, tone?: string) => {
    cells.forEach((cell, i) =>
      doc
        .font(bold || i === 0 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(10)
        .fillColor(i === 3 && tone ? tone : bold ? muted : ink)
        .text(readable(cell), cols[i], y, {
          width: i === 0 ? 240 : 80,
          lineBreak: false,
        }),
    );
  };
  ensure(30 + result.rows.length * 24);
  let y = doc.y;
  row(["Measure", "Before", "After", "Change"], y, true);
  y += 18;
  for (const r of result.rows) {
    doc.rect(M, y - 5, W, 22).fill(paper);
    const change = r.better === null ? "Same" : r.better ? "Better" : "Worse";
    row(
      [
        r.label,
        formatValue(r.before, r.unit),
        formatValue(r.after, r.unit),
        r.before === null || r.after === null ? "-" : change,
      ],
      y,
      false,
      r.better === null ? muted : r.better ? good : bad,
    );
    y += 24;
  }
  doc.y = y + 6;
  if (!result.measured)
    text(
      "One of the two audits doesn't have three comparable runs, so its scores can't be compared fairly. Re-test the store to fill them in.",
      10,
      bad,
    );
  text(
    "Scores from a lab test move a few points between runs, so small changes are noise. Field data from real visitors updates over 28 days and isn't compared here.",
    9.5,
    muted,
  );

  const list = (heading: string, items: Finding[], empty: string) => {
    ensure(60);
    doc.y += 6;
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(ink)
      .text(heading, M, doc.y, { width: W });
    doc.y += 6;
    if (!items.length) return text(empty, 10, muted);
    // Plain-language titles, one line per issue, as in the audit report.
    for (const issue of reportIssues(items, []))
      text(`- ${explainFinding(issue, items, []).title}`, 10.5);
  };
  list("Fixed", result.fixed, "No earlier findings were fixed yet.");
  list(
    "Still open",
    result.open,
    "Nothing from the first audit is still open.",
  );
  if (result.added.length) list("New since the first audit", result.added, "");

  ensure(110);
  doc.y += 14;
  const lines = [
    [input.sender.name, input.sender.company].filter(Boolean).join(", ") ||
      from,
    ...contactLines(input.sender),
    ...(input.sender.portfolio_url
      ? [`See our work: ${portfolioLabel(input.sender.portfolio_url)}`]
      : []),
  ];
  const boxY = doc.y;
  const h = 30 + lines.length * 16;
  doc.roundedRect(M, boxY, W, h, 8).fill(paper);
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(goldDark)
    .text("PREPARED BY", M + 18, boxY + 14, { characterSpacing: 0.4 });
  lines.forEach((l, i) =>
    doc
      .font(i === 0 ? "Helvetica-Bold" : "Helvetica")
      .fontSize(10.5)
      .fillColor(i === 0 ? ink : goldDark)
      .text(readable(l), M + 18, boxY + 28 + i * 16, { width: W - 36 }),
  );
  doc.end();
  return done;
}
