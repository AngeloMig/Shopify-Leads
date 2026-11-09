import { describe, expect, it } from "vitest";
import { phoneSpeedCard } from "../server/modules/report";

describe("Why speed on a phone matters: the store's own card", () => {
  it("leads with the phone test when it's slow and real visitors are fast", () => {
    // roadarmor.com: 14.51 s in the lab, 1.06 s for real visitors.
    const card = phoneSpeedCard(14510, 1060);
    expect(card.big).toBe("14.5s");
    expect(card.text).toMatch(/Google's phone test/);
    expect(card.text).toMatch(/3 in 4 within 1\.1 seconds/);
    expect(card.source).toMatch(/PageSpeed.*Chrome UX/);
  });
  it("uses real visitors when they also wait too long", () => {
    const card = phoneSpeedCard(9000, 4200);
    expect(card.big).toBe("4.2s");
    expect(card.text).toMatch(/real phone visitors/);
    expect(card.text).toMatch(/target is 2\.5 seconds/);
  });
  it("says a fast store is within the target", () => {
    const card = phoneSpeedCard(2100, 1300);
    expect(card.big).toBe("1.3s");
    expect(card.text).toMatch(/within Google's 2\.5-second target/);
  });
  it("falls back to the test when Google has no real-visitor data", () => {
    const card = phoneSpeedCard(6200, null);
    expect(card.big).toBe("6.2s");
    expect(card.text).not.toMatch(/real phone visitors/);
    expect(card.source).toBe("Google PageSpeed Insights, this check");
  });
  it("admits when there's no reliable number", () => {
    expect(phoneSpeedCard(null, null).big).toBe("Your store");
  });
});

import { productSpeedOf } from "../shared/types";
describe("A product page's phone test", () => {
  it("reads the score and timings, and drops values that aren't real", () => {
    const speed = productSpeedOf({
      url: "https://shop.example/products/a",
      strategy: "mobile",
      sample: 1,
      tested_at: "2026-11-10T00:00:00Z",
      scores: { performance: 41 },
      diagnostics: {
        "largest-contentful-paint": { numericValue: 8123 },
        "total-blocking-time": { numericValue: -1 },
      },
      field_data: { available: false, scope: "unavailable", metrics: {} },
    });
    expect(speed).toEqual({
      url: "https://shop.example/products/a",
      tested_at: "2026-11-10T00:00:00Z",
      performance: 41,
      lcp_ms: 8123,
      tbt_ms: null,
    });
  });
});
