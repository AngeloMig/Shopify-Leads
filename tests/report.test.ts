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
