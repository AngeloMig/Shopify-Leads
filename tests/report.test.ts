import { it, expect } from "vitest";
import { createReport } from "../server/modules/report";
import { emptySender } from "../shared/sender";
it("creates an actual PDF from evidence with no fabricated metrics", async () => {
  const pdf = await createReport({
    name: "Fixture",
    domain: "fixture.example",
    date: "2026-10-27",
    findings: [],
    samples: [],
    recommendations: [],
    activity: null,
    priority: 0,
    modernization: null,
    technologies: [],
    history: "Unavailable",
    demo: true,
  });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(3000);
});

it("names a source for every outside fact in the report", async () => {
  const { phoneFacts } = await import("../server/modules/report");
  expect(phoneFacts.length).toBeGreaterThanOrEqual(5);
  for (const fact of phoneFacts) {
    expect(fact.source.length).toBeGreaterThan(5);
    expect(fact.text.length).toBeGreaterThan(20);
  }
});

it("builds the owner's report with your details and plain wording", async () => {
  const sample = (strategy: "mobile" | "desktop", n: number) => ({
    strategy,
    sample: n,
    url: "https://fixture.example/",
    tested_at: `2026-11-03T00:0${n}:00Z`,
    scores: {
      performance: 28,
      seo: 92,
      accessibility: 79,
      "best-practices": 96,
    },
    diagnostics: {
      "largest-contentful-paint": { numericValue: 15100 },
      "cumulative-layout-shift": { numericValue: 0.04 },
      "total-blocking-time": { numericValue: 2800 },
    },
    field_data: {
      available: n === 1 && strategy === "mobile",
      scope: "origin",
      metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2660 } },
    },
    environment: {
      lighthouse_version: "13.0.0",
      form_factor: strategy,
      throttling_method: "simulate",
    },
  });
  const pdf = await createReport({
    name: "Fixture Skin",
    domain: "fixture.example",
    date: "2026-11-03",
    industry: "Beauty & skincare",
    findings: [
      {
        id: "f1",
        url: "https://fixture.example/",
        category: "Images",
        title: "Images without alt attributes",
        severity: "medium",
        kind: "verified",
        confidence: "high",
        evidence: "4/10 images have no alt attribute",
        recommendation: "Add alt text.",
      },
    ] as never,
    samples: [1, 2, 3].flatMap((n) => [
      sample("mobile", n),
      sample("desktop", n),
    ]) as never,
    recommendations: [],
    activity: null,
    priority: 0,
    modernization: null,
    technologies: [],
    history: "",
    sender: {
      ...emptySender,
      name: "Grant",
      company: "Studio",
      address: "",
      portfolio_url: "https://studio.example/",
      work: [
        {
          title: "Skinistry",
          url: "https://studio.example/work/skinistry/",
          industry: "Beauty & skincare",
        },
      ],
    },
  });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(8000);
});
it("shows the phone screenshot when browser checks captured one", async () => {
  // A 1x1 PNG is enough to prove the image is placed, not skipped.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const base = {
    name: "Fixture",
    domain: "fixture.example",
    date: "2026-10-27",
    findings: [],
    samples: [],
    recommendations: [],
    activity: null,
    priority: 0,
    modernization: null,
    technologies: [],
    history: "",
  };
  const without = await createReport(base);
  const withShot = await createReport({ ...base, screenshot: png });
  expect(withShot.toString("latin1")).toContain("/Subtype /Image");
  expect(without.toString("latin1")).not.toContain("/Subtype /Image");
});

// The report's text, decoded from its compressed content streams.
function pdfText(pdf: Buffer) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require("node:zlib") as typeof import("node:zlib");
  let out = "",
    i = 0;
  while ((i = pdf.indexOf("stream", i)) !== -1) {
    if (pdf.subarray(i - 3, i).toString() === "end") {
      i += 6;
      continue;
    }
    let s = i + 6;
    if (pdf[s] === 13) s++;
    if (pdf[s] === 10) s++;
    const e = pdf.indexOf("endstream", s);
    try {
      const t = zlib.inflateSync(pdf.subarray(s, e)).toString("latin1");
      for (const m of t.matchAll(/<([0-9a-fA-F]+)>/g))
        out += Buffer.from(m[1], "hex").toString("latin1");
    } catch {
      /* not a content stream */
    }
    i = e + 9;
  }
  return out;
}

it("reports a product page's phone test apart from the home page", async () => {
  const pdf = await createReport({
    name: "Fixture",
    domain: "fixture.example",
    date: "2026-10-27",
    findings: [],
    samples: [],
    recommendations: [],
    activity: null,
    priority: 0,
    modernization: null,
    technologies: [],
    history: "",
    product_speed: {
      url: "https://fixture.example/products/mug",
      tested_at: "2026-10-27T01:00:00Z",
      performance: 34,
      lcp_ms: 9200,
      tbt_ms: 640,
    },
  });
  const text = pdfText(pdf);
  expect(text).toContain(
    "A product page, where shoppers decide to buy, took about 9.2 seconds",
  );
  expect(text).toContain("A product page on a phone (lab, one run)");
  expect(text).toContain("34/100");
});

it("leads page 1 with the fixes that cost the most, in the store's own numbers", async () => {
  const run = (strategy: "mobile" | "desktop", n: number) => ({
    strategy,
    sample: n,
    url: "https://fixture.example/",
    tested_at: `2026-11-03T00:0${n}:00Z`,
    scores: {
      performance: 40,
      seo: 92,
      accessibility: 90,
      "best-practices": 96,
    },
    diagnostics: {
      "largest-contentful-paint": { numericValue: 6200 },
      "network-requests": {
        details: { items: Array.from({ length: 212 }, () => ({})) },
      },
      "total-byte-weight": { numericValue: 4_300_000 },
      "unused-javascript": {
        title: "Reduce unused JavaScript",
        details: {
          overallSavingsMs: 3000,
          overallSavingsBytes: 862_500,
          items: [
            { url: "https://cdn.example/app.js", wastedBytes: 600_000 },
            { url: "https://cdn.example/reviews.js", wastedBytes: 262_500 },
          ],
        },
      },
      "image-delivery-insight": {
        title: "Improve image delivery",
        displayValue: "Est savings of 750 KiB",
        metricSavings: { FCP: 0, LCP: 700 },
        details: { items: [] },
      },
    },
    field_data: { available: false, scope: "origin", metrics: {} },
    environment: {
      lighthouse_version: "13.0.0",
      form_factor: strategy,
      throttling_method: "simulate",
    },
  });
  const finding = (
    id: string,
    title: string,
    category: string,
    evidence: string,
  ) => ({
    id,
    url: "https://fixture.example/",
    category,
    title,
    severity: "medium",
    kind: "verified",
    confidence: "high",
    evidence,
    recommendation: "Fix it.",
  });
  const pdf = await createReport({
    name: "Fixture",
    domain: "fixture.example",
    date: "2026-11-03",
    findings: [
      // Listed first, but nothing measured it: it shouldn't lead.
      finding(
        "d",
        "Duplicate script references",
        "Frontend",
        "Repeated src attributes: https://cdn.example/a.js",
      ),
      finding(
        "j",
        "Reduce unused JavaScript",
        "Frontend",
        "Lighthouse mobile unused-javascript",
      ),
      finding(
        "i",
        "Improve image delivery",
        "Images",
        "Lighthouse mobile image-delivery-insight",
      ),
    ] as never,
    samples: [1, 2, 3].flatMap((n) => [
      run("mobile", n),
      run("desktop", n),
    ]) as never,
    recommendations: [],
    activity: null,
    priority: 0,
    modernization: null,
    technologies: [],
    history: "",
  });
  const flat = (s: string) => s.replace(/\s+/g, "");
  const text = flat(pdfText(pdf));
  const has = (s: string) => expect(text).toContain(flat(s));
  has("and the phone downloaded 212 files (4.3 MB)");
  has(
    "On your home page, phones download 860 KB of code that isn't used, spread over 2 files, which Google estimates adds about 3.0 seconds on a phone.",
  );
  has(
    "The images on your home page are about 770 KB heavier than they need to be, which Google estimates adds about 0.7 seconds on a phone.",
  );
  has("After the fix:");
  // Measured fixes first; the unmeasured one after them.
  const order = [
    "The page downloads code it doesn't use",
    "Some images are bigger than they need to be",
    "The same code is loaded more than once",
  ].map((title) => text.indexOf(flat(title)));
  expect(order[0]).toBeGreaterThan(-1);
  expect(order[0]).toBeLessThan(order[1]);
  expect(order[1]).toBeLessThan(order[2]);
  // Page 2 ends with what it could mean, framed as Google's estimate and research.
  has("What fixing these could mean for you");
  has("That 6.2s above is about 3.7 seconds over Google's 2.5-second target.");
  has(
    "In Google's phone test, fix 1 alone could cut about 3.0 seconds from your home page",
  );
  has("The sales figure is published research, not a forecast for your store.");
});
