import { describe, it, expect } from "vitest";
import {
  median,
  scorePriority,
  qualifies,
  csvCell,
  type PriorityEvidence,
} from "../shared/scoring";
import { defaultSettings, moderateScreening } from "../shared/types";
const complete: PriorityEvidence = {
  serviceFit: true,
  verifiedOpportunity: true,
  timingSignal: true,
  active: true,
  appropriateContact: true,
  feasibleScope: true,
  countryVerified: true,
  shopifyVerified: true,
  permissionApproved: true,
  suppressed: false,
};
describe("Evidence-based qualification", () => {
  it("includes moderate issues but screens out healthy and unknown scores", () => {
    expect(qualifies({ performance: 75, seo: 99 }, moderateScreening)).toBe(
      true,
    );
    expect(qualifies({ performance: 95, seo: 85 }, moderateScreening)).toBe(
      true,
    );
    expect(
      qualifies(
        { performance: 95, seo: 99, modernization: 50 },
        moderateScreening,
      ),
    ).toBe(true);
    expect(
      qualifies(
        { performance: 90, seo: 95, modernization: 15 },
        moderateScreening,
      ),
    ).toBeFalsy();
    expect(
      qualifies(
        { performance: null, seo: null, modernization: null },
        moderateScreening,
      ),
    ).toBeFalsy();
  });
  it("uses a median without treating missing results as zero", () => {
    expect(median([49, 11, 35])).toBe(35);
    expect(median([])).toBe(null);
    expect(median([1, NaN])).toBe(null);
    expect(median([10, 20])).toBe(15);
  });
  it("qualifies on any observed threshold; unknowns do not qualify", () => {
    expect(
      qualifies({ performance: null, seo: null }, defaultSettings),
    ).toBeFalsy();
    expect(qualifies({ performance: 49, seo: 99 }, defaultSettings)).toBe(true);
    expect(qualifies({ performance: 95, seo: 80 }, defaultSettings)).toBe(true);
    expect(
      qualifies(
        { performance: 95, seo: 99, modernization: 65 },
        defaultSettings,
      ),
    ).toBe(true);
    expect(
      qualifies(
        { performance: 95, seo: 99, verifiedCro: true },
        defaultSettings,
      ),
    ).toBe(true);
  });
  it("uses the exact 100-point research model and priority bands", () => {
    expect(scorePriority(complete).priority).toBe(100);
    expect(
      scorePriority({
        ...complete,
        timingSignal: false,
        appropriateContact: false,
      }).band,
    ).toBe("A");
    expect(
      scorePriority({
        ...complete,
        timingSignal: false,
        verifiedOpportunity: false,
      }).band,
    ).toBe("B");
    expect(scorePriority({ ...complete, serviceFit: false }).priority).toBe(0);
  });
  it.each([
    "countryVerified",
    "shopifyVerified",
    "permissionApproved",
  ] as const)("blocks priority when %s is unknown", (gate) => {
    const result = scorePriority({ ...complete, [gate]: false });
    expect(result.priority).toBe(0);
    expect(result.researchScore).toBe(100);
    expect(result.eligible).toBe(false);
  });
  it("suppression overrides otherwise strong evidence", () =>
    expect(scorePriority({ ...complete, suppressed: true }).priority).toBe(0));
  it("unknown research evidence receives zero points", () => {
    const evidence = {
      ...complete,
      serviceFit: false,
      verifiedOpportunity: false,
      timingSignal: false,
      active: false,
      appropriateContact: false,
      feasibleScope: false,
      independent: false,
    };
    expect(scorePriority(evidence).researchScore).toBe(0);
  });
  it("escapes CSV fields and neutralizes spreadsheet formulas", () => {
    expect(csvCell('=HYPERLINK("https://evil")')).toBe(
      '"\'=HYPERLINK(""https://evil"")"',
    );
    expect(csvCell("normal, value")).toBe('"normal, value"');
    expect(csvCell("  +cmd")).toBe('"\'  +cmd"');
  });
});
