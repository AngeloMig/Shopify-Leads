import { describe, expect, it } from "vitest";
import {
  keywordLibrary,
  customKeywords,
  searchKeywords,
} from "../shared/discovery-keywords";
import { defaultSettings } from "../shared/types";
import { settingsSchema } from "../server/lib/validation";
import { inspectHtml } from "../server/modules/html-audit";

describe("Discovery coverage", () => {
  it("rotates a substantial library of focused phrases instead of one combined query", () => {
    expect(Object.values(keywordLibrary).flat().length).toBeGreaterThanOrEqual(
      100,
    );
    expect(searchKeywords(defaultSettings, "Beauty & skincare")).toContain(
      "natural skincare",
    );
    expect(searchKeywords(defaultSettings, "Beauty & skincare")).not.toContain(
      "solid wood furniture",
    );
    expect(
      customKeywords("linen bedding, ceramics\nlinen bedding; candles"),
    ).toEqual(["linen bedding", "ceramics", "candles"]);
    expect(
      searchKeywords(
        { ...defaultSettings, keywords: "custom shop", keyword_library: false },
        "Home decor",
      ),
    ).toEqual(["custom shop"]);
  });
  it("validates the optional ideal client", () => {
    const parse = (ideal_client: unknown) =>
      settingsSchema.safeParse({ ...defaultSettings, ideal_client }).success;
    expect(settingsSchema.parse(defaultSettings).ideal_client).toBeUndefined();
    expect(parse(null)).toBe(true);
    expect(parse({ min_products: 5, max_products: null, min_price: 10 })).toBe(
      true,
    );
    expect(parse({ min_products: 50, max_products: 5 })).toBe(false);
    expect(parse({ min_price: 90, max_price: 10 })).toBe(false);
    expect(parse({ min_products: -1 })).toBe(false);
    expect(parse({ active_within_days: 0 })).toBe(false);
    expect(parse({ revenue: 1 })).toBe(false);
  });
  it("validates the search cap and supports old saved settings without silently increasing costs", () => {
    expect(settingsSchema.parse(defaultSettings).searches_per_run).toBe(1);
    expect(
      settingsSchema.parse({ ...defaultSettings, searches_per_run: undefined })
        .searches_per_run,
    ).toBe(1);
    expect(
      settingsSchema.safeParse({ ...defaultSettings, searches_per_run: 4 })
        .success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({
        ...defaultSettings,
        keywords: "x".repeat(101),
      }).success,
    ).toBe(false);
  });
  it.each([
    ["US", "123 Main Street, Portland, OR 97201, United States"],
    ["GB", "10 High Street, London SW1A 1AA, United Kingdom"],
    ["CA", "123 Queen Street, Toronto ON M5V 2T6, Canada"],
    ["AU", "12 George Street, Sydney NSW 2000, Australia"],
  ])(
    "records explicit %s public business addresses with source evidence",
    (country, address) => {
      const result = inspectHtml(
        `<address>${address.replaceAll(", ", "<br>")}</address>`,
        "https://merchant.com/pages/contact",
      );
      expect(result.country).toBe(country);
      expect(result.country_evidence).toContain(
        "https://merchant.com/pages/contact: public business address:",
      );
    },
  );
  it("can read a labeled business address without an address element", () => {
    expect(
      inspectHtml(
        "<p>Visit us: 10 High Street, London SW1A 1AA, United Kingdom</p>",
        "https://merchant.com",
      ).country,
    ).toBe("GB");
  });
  it.each([
    "<p>We ship to Canada, Australia, United States and United Kingdom.</p>",
    "<address>Shipping address: 123 Main Street, Portland OR 97201, United States</address>",
    "<address>Our store: 123 Main Street, Portland OR 97201</address>",
    "<address hidden>123 Main Street, Portland OR 97201, United States</address>",
    "<address>123 Main Street, Portland OR 97201, United States</address><address>123 Queen Street, Toronto ON M5V 2T6, Canada</address>",
  ])(
    "leaves country unknown for shipping, hidden, incomplete or conflicting evidence",
    (html) => {
      expect(inspectHtml(html, "https://merchant.com").country).toBeNull();
    },
  );
});
