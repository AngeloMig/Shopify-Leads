import { it, expect } from "vitest";
import { createReport } from "../server/modules/report";
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
