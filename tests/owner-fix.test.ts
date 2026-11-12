import { describe, it, expect } from "vitest";
import type { ReportIssue } from "../shared/audit-presentation";
import {
  ownerNow,
  ownerOrder,
  pageName,
  seconds,
  size,
  biggestSaving,
} from "../shared/owner-fix";

const issue = (
  title: string,
  impact: ReportIssue["impact"],
  extra: Partial<ReportIssue> = {},
): ReportIssue => ({
  reference: "F01",
  title,
  category: "Frontend",
  severity: "medium",
  kind: "verified",
  confidence: "high",
  urls: ["https://store.example/"],
  ids: ["f1"],
  meaning: "",
  action: "",
  validation: "",
  service: "",
  evidence: [],
  resources: [],
  impact,
  ...extra,
});
const home = "https://store.example/";

describe("The owner's page 1", () => {
  it("names pages the way an owner would", () => {
    expect(pageName(home)).toBe("your home page");
    expect(pageName("https://store.example/products/mug")).toBe(
      "a product page",
    );
    expect(pageName("https://store.example/collections/all")).toBe(
      "a collection page",
    );
    expect(pageName("https://store.example/pages/faq")).toBe(
      "one of your pages",
    );
  });

  it("rounds sizes and times so they read as estimates", () => {
    expect(size(862_500)).toBe("860 KB");
    expect(size(39_400)).toBe("39 KB");
    expect(size(6_400_000)).toBe("6.4 MB");
    expect(seconds(3140)).toBe("3.1 seconds");
  });

  it("says what a fix costs now, only from what was measured", () => {
    expect(
      ownerNow(
        issue("Reduce unused CSS", {
          ms: 2250,
          bytes: 468_200,
          files: 6,
          url: home,
        }),
        [],
      ),
    ).toBe(
      "On your home page, phones download 470 KB of styling that isn't used, spread over 6 files, which Google estimates adds about 2.3 seconds on a phone.",
    );
    // A tiny time saving isn't claimed.
    expect(
      ownerNow(
        issue("Reduce unused JavaScript", {
          ms: 0,
          bytes: 34_000,
          files: 1,
          url: home,
        }),
        [],
      ),
    ).toBe("On your home page, phones download 34 KB of code that isn't used.");
    expect(ownerNow(issue("Duplicate script references", null), [])).toBeNull();
  });

  it("counts images with no description on the page that has the most", () => {
    const findings = [
      { id: "a", url: home, evidence: "1/33 images have no alt attribute" },
      {
        id: "b",
        url: "https://store.example/collections/all",
        evidence: "2/381 images have no alt attribute",
      },
    ] as never;
    expect(
      ownerNow(
        issue("Images without alt attributes", null, {
          ids: ["a", "b"],
          urls: [home, "https://store.example/collections/all"],
        }),
        findings,
      ),
    ).toBe(
      "2 of the 381 images on a collection page have no description, and we found the same on 1 more page.",
    );
  });

  it("puts the biggest measured saving first and keeps the rest in order", () => {
    const a = issue("Duplicate script references", null),
      b = issue("Reduce unused CSS", {
        ms: 300,
        bytes: 88_000,
        files: 4,
        url: home,
      }),
      c = issue("Reduce unused JavaScript", {
        ms: 3000,
        bytes: 862_500,
        files: 14,
        url: home,
      }),
      d = issue("Images without alt attributes", null);
    expect(ownerOrder([a, b, c, d]).map((i) => i.title)).toEqual([
      "Reduce unused JavaScript",
      "Reduce unused CSS",
      "Duplicate script references",
      "Images without alt attributes",
    ]);
    expect(biggestSaving([a, b, c, d])?.ms).toBe(3000);
    // Under 0.3 seconds isn't worth a sales sentence.
    expect(
      biggestSaving(
        [b, a].map((i) => ({
          ...i,
          impact: i.impact && { ...i.impact, ms: 200 },
        })),
      ),
    ).toBeNull();
  });
});
