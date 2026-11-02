import { describe, expect, it } from "vitest";
import { lighthouseScore } from "../shared/lighthouse-score";

describe("PageSpeed score interpretation", () => {
  it("uses Lighthouse boundaries, including 80–89 needing improvement", () => {
    expect(
      [0, 49, 50, 78, 80, 89, 90, 100].map(
        (value) => lighthouseScore(value).band,
      ),
    ).toEqual([
      "poor",
      "poor",
      "average",
      "average",
      "average",
      "average",
      "good",
      "good",
    ]);
  });
  it("keeps missing or invalid measurements unknown rather than turning them into zero", () => {
    for (const value of [null, undefined, NaN, Infinity, -1, 101, "78"]) {
      expect(lighthouseScore(value)).toEqual({
        score: null,
        band: "unknown",
        label: "Unavailable",
      });
    }
    expect(lighthouseScore(0).score).toBe(0);
  });
});
