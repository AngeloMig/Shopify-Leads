import { describe, expect, it, vi } from "vitest";
import { inspectStorefront } from "../server/modules/storefront";
import { defaultSettings } from "../shared/types";
const unknown = { country: null, country_evidence: null };
const storefront = `<title>Merchant</title><script>Shopify.shop="merchant.myshopify.com"</script><img src="https://cdn.shopify.com/s/files/logo.png"><a href="/products/lamp">Lamp</a>`;
const address = (country: string) =>
  `<script type="application/ld+json">{"@type":"Organization","url":"https://merchant.com","address":{"addressCountry":"${country}"}}</script>`;
const page = (body: string, url = "https://merchant.com/") => ({
  url,
  status: 200,
  headers: { "content-type": "text/html" },
  body: Buffer.from(body),
});
const noCatalog = {
  url: "https://merchant.com/products.json",
  status: 404,
  headers: { "content-type": "text/html" },
  body: Buffer.from("Not found"),
};
const feed = (products: unknown[], status = 200) => ({
  url: "https://merchant.com/products.json",
  status,
  headers: { "content-type": "application/json" },
  body: Buffer.from(JSON.stringify({ products })),
});
const product = (handle: string, price = "40.00", published = new Date()) => ({
  handle,
  published_at: published.toISOString(),
  updated_at: published.toISOString(),
  variants: [{ price }],
});
/** Answers by URL, so tests don't depend on the order requests are made in. */
const routed = (home: string, catalog: unknown, contact?: unknown) =>
  vi.fn(async (url: string): Promise<any> => {
    if (url.includes("/products.json")) {
      if (catalog instanceof Error) throw catalog;
      return catalog;
    }
    if (url.includes("/contact")) {
      if (contact instanceof Error) throw contact;
      return contact;
    }
    return page(home);
  });
describe("Live storefront screening", () => {
  it("rejects an article even when its publisher has a supported-country address", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        page(`<title>Best Shopify stores</title>${address("US")}`),
      );
    const result = await inspectStorefront(
      "merchant.com",
      defaultSettings,
      { fetch },
      unknown,
    );
    expect(result.reason).toBe("Shopify evidence insufficient");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("accepts a Shopify storefront only with product activity and independently evidenced country", async () => {
    const fetch = vi.fn().mockResolvedValue(page(storefront + address("US")));
    const result = await inspectStorefront(
      "merchant.com",
      defaultSettings,
      { fetch },
      unknown,
    );
    expect(result.reason).toBeNull();
    expect(result.verified).toBe(true);
    expect(result.country).toBe("US");
    expect(result.activity).toBeGreaterThanOrEqual(50);
  });
  it("can verify the same business's country from its linked contact page", async () => {
    const fetch = routed(
      storefront + `<a href="/pages/contact">Contact</a>`,
      noCatalog,
      page(address("Canada"), "https://merchant.com/pages/contact"),
    );
    const result = await inspectStorefront(
      "merchant.com",
      defaultSettings,
      { fetch },
      unknown,
    );
    expect(result.reason).toBeNull();
    expect(result.country).toBe("CA");
    expect(result.country_evidence).toContain("/pages/contact");
  });
  it("does not invent a country when optional contact evidence is unavailable", async () => {
    const fetch = routed(
      storefront + `<a href="/pages/contact">Contact</a>`,
      noCatalog,
      new Error("Unavailable"),
    );
    const result = await inspectStorefront(
      "merchant.com",
      defaultSettings,
      { fetch },
      unknown,
    );
    expect(result.country).toBeNull();
    expect(result.reason).toBe("Target country unverified or excluded");
  });
  it("reads the public catalog and records its evidence", async () => {
    const fetch = routed(
      storefront + address("US"),
      feed([product("a"), product("b")]),
    );
    const result = await inspectStorefront(
      "merchant.com",
      defaultSettings,
      { fetch },
      unknown,
    );
    expect(result.catalog?.product_count).toBe(2);
    expect(result.catalog?.source_url).toBe(
      "https://merchant.com/products.json?limit=250",
    );
    expect(result.activity).toBe(80);
    expect(result.fit.status).toBe("not_set");
  });
  it("accepts a real product feed as Shopify evidence alongside one homepage signal", async () => {
    const oneSignal = `<title>Merchant</title><img src="https://cdn.shopify.com/s/files/logo.png"><a href="/products/lamp">Lamp</a>${address("US")}`;
    const without = await inspectStorefront(
      "merchant.com",
      defaultSettings,
      { fetch: routed(oneSignal, noCatalog) },
      unknown,
    );
    expect(without.verified).toBe(false);
    const withFeed = await inspectStorefront(
      "merchant.com",
      defaultSettings,
      { fetch: routed(oneSignal, feed([product("a")])) },
      unknown,
    );
    expect(withFeed.verified).toBe(true);
    expect(withFeed.reason).toBeNull();
  });
  it.each([
    ["is missing", noCatalog],
    ["fails", new Error("Crawling disallowed by robots.txt")],
    ["is malformed", { ...feed([]), body: Buffer.from("<not json>") }],
    ["has the wrong shape", feed([{ title: "x" }])],
  ])("keeps screening when the catalog %s", async (_, catalog) => {
    const result = await inspectStorefront(
      "merchant.com",
      defaultSettings,
      { fetch: routed(storefront + address("US"), catalog) },
      unknown,
    );
    expect(result.catalog).toBeNull();
    expect(result.reason).toBeNull();
  });
  it("never requests a catalog from a site showing no Shopify evidence", async () => {
    const fetch = routed(
      `<title>Blog</title>${address("US")}`,
      feed([product("a")]),
    );
    await inspectStorefront(
      "merchant.com",
      defaultSettings,
      { fetch },
      unknown,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  describe("ideal client", () => {
    const config = { ...defaultSettings, ideal_client: { min_products: 10 } };
    it("reports a mismatch separately, so a requested audit can still run", async () => {
      const result = await inspectStorefront(
        "merchant.com",
        config,
        { fetch: routed(storefront + address("US"), feed([product("a")])) },
        unknown,
      );
      expect(result.reason).toBeNull();
      expect(result.fit.status).toBe("outside");
      expect(result.fitReason).toMatch(
        /^Outside ideal client: 1 products, below the 10 minimum/,
      );
    });
    it("keeps a store whose catalog can't be read", async () => {
      const result = await inspectStorefront(
        "merchant.com",
        config,
        { fetch: routed(storefront + address("US"), noCatalog) },
        unknown,
      );
      expect(result.fit.status).toBe("unknown");
      expect(result.fitReason).toBeNull();
    });
  });
  it("honors cancellation before making the first storefront request", async () => {
    const fetch = vi.fn();
    await expect(
      inspectStorefront(
        "merchant.com",
        defaultSettings,
        { fetch },
        unknown,
        async () => {
          throw new Error("Cancelled");
        },
      ),
    ).rejects.toThrow("Cancelled");
    expect(fetch).not.toHaveBeenCalled();
  });
});
