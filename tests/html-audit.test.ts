import { describe, it, expect } from "vitest";
import { inspectHtml } from "../server/modules/html-audit";
describe("Public evidence extraction", () => {
  it("reads an explicitly published returns mailbox on another domain", () => {
    expect(
      inspectHtml(
        "<title>Refund policy</title><p>To request a return, please contact us at:dkfabrications2@gmail.com</p>",
        "https://dkfabrications.com/policies/refund-policy",
        "contact",
      ).emails,
    ).toEqual([
      {
        email: "dkfabrications2@gmail.com",
        source_url: "https://dkfabrications.com/policies/refund-policy",
      },
    ]);
  });
  it("does not treat a payment provider's FAQ email as a merchant mailbox", () => {
    expect(
      inspectHtml(
        "<title>FAQ</title><p>For Shop Pay payments, email installments@shop.app.</p>",
        "https://pinklily.com/pages/faq",
        "contact",
      ).emails,
    ).toEqual([]);
  });
  it("recognizes labelled parent-brand mailboxes on contact pages only", () => {
    const html =
      '<p>Contact Email: inika@inikaorganic.com.au</p><p>Fill out the form or e-mail us at hello@vainaboutmyskin.com</p><p>Powered by vendor@analytics.com</p><div class="review"><p>Email: shopper@gmail.com</p></div>';
    expect(
      inspectHtml(html, "https://merchant.com/pages/contact-us").emails.map(
        (e) => e.email,
      ),
    ).toEqual(["inika@inikaorganic.com.au", "hello@vainaboutmyskin.com"]);
    expect(
      inspectHtml(html, "https://merchant.com/products/item").emails,
    ).toEqual([]);
  });
  it("reads published Cloudflare email encoding and retains the source", () => {
    const encoded =
      "b2d1c7c1c6dddfd7c0c1d7c0c4dbd1d7f2c2c7c0dbc6cbd1ddc1dfd7c6dbd1c19cd1dddf";
    const url = "https://www.100percentpure.com/pages/contact-us";
    expect(
      inspectHtml(
        `<a href="/cdn-cgi/l/email-protection#${encoded}"><span data-cfemail="${encoded}">[email protected]</span></a>`,
        url,
      ).emails,
    ).toEqual([
      { email: "customerservice@puritycosmetics.com", source_url: url },
    ]);
    expect(
      inspectHtml(
        `<span data-cfemail="xx">invalid</span><span hidden data-cfemail="${encoded}">hidden</span>`,
        url,
      ).emails,
    ).toEqual([]);
  });
  it("extracts and deduplicates published text and mailto emails with source URLs", () => {
    const url = "https://www.merchant.com/pages/contact";
    const result = inspectHtml(
      `<p>Email: Hello@merchant.com.</p>
      <a href="mailto:hello%40merchant.com?subject=Question&cc=private@other.com">Email</a>
      <a href="MAILTO:merchant.team@gmail.com">Contact the team</a>`,
      url,
    );
    expect(result.emails).toEqual([
      { email: "hello@merchant.com", source_url: url },
      { email: "merchant.team@gmail.com", source_url: url },
    ]);
  });
  it("does not invent emails or extract script, vendor, placeholder or non-reply addresses", () => {
    const result = inspectHtml(
      `<script>const email = "secret@merchant.com";</script>
      <p>powered by vendor@analytics.com</p><p>no-reply@merchant.com</p>
      <p hidden>hidden@merchant.com</p><a href="mailto:hello@example.com">Template</a>
      <a href="mailto:%broken">Broken</a>`,
      "https://merchant.com",
    );
    expect(result.emails).toEqual([]);
    expect(
      inspectHtml("<p>Contact us using the form</p>", "https://merchant.com")
        .emails,
    ).toEqual([]);
  });
  it("does not infer country, sales, or technology versions from .com", () => {
    const result = inspectHtml(
      '<title>Store</title><a href="/products/example">Product</a>',
      "https://example.com",
    );
    expect(result.country).toBe(null);
    expect(result.activity.products).toBe(true);
    expect(result.shopify).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/revenue|confirmed.sales/);
  });
  it("records exact URLs and inspectable evidence for missing metadata", () => {
    const result = inspectHtml(
      '<h1>One</h1><h1>Two</h1><img src="/hero.jpg">',
      "https://example.com/products/item",
      "product",
    );
    expect(
      result.findings.every(
        (f) => f.url === "https://example.com/products/item" && !!f.evidence,
      ),
    ).toBe(true);
    expect(
      result.findings.find((f) => f.title === "Image dimensions need review")
        ?.kind,
    ).toBe("hypothesis");
    expect(result.findings.find((f) => f.category === "CRO")?.kind).toBe(
      "hypothesis",
    );
  });
  it("uses explicit structured-data country evidence", () => {
    const html =
      '<script type="application/ld+json">{"@type":"Organization","address":{"@type":"PostalAddress","addressCountry":"Canada"}}</script>';
    const result = inspectHtml(html, "https://example.com");
    expect(result.country).toBe("CA");
    expect(result.country_evidence).toContain("addressCountry=Canada");
  });
  it("detects public Shopify and CRM indicators with provenance", () => {
    const result = inspectHtml(
      '<script>Shopify.shop="shop.myshopify.com"</script><img src="https://cdn.shopify.com/s/files/a.jpg"><script src="https://static.klaviyo.com/test.js"></script>',
      "https://example.com",
    );
    expect(result.shopify).toHaveLength(2);
    expect(result.technologies[0]).toEqual({
      vendor: "Klaviyo",
      evidence: "static.klaviyo.com",
    });
  });
  it("labels invalid JSON-LD and noindex without claiming Google index absence", () => {
    const result = inspectHtml(
      '<meta name="robots" content="noindex"><script type="application/ld+json">invalid</script>',
      "https://example.com",
    );
    expect(result.findings.some((f) => f.title === "Invalid JSON-LD")).toBe(
      true,
    );
    expect(
      result.findings.find((f) => f.title.includes("Noindex"))?.recommendation,
    ).toContain("does not verify Google index status");
  });
});
it("does not use shipping destinations or unrelated organizations as business-country evidence", () => {
  const shipping =
    '<script type="application/ld+json">{"@type":"Product","offers":{"shippingDetails":{"shippingDestination":{"addressCountry":"US"}}}}</script>';
  const unrelated =
    '<script type="application/ld+json">{"@type":"Organization","url":"https://unrelated.example","address":{"addressCountry":"US"}}</script>';
  expect(inspectHtml(shipping, "https://merchant.com").country).toBeNull();
  expect(inspectHtml(unrelated, "https://merchant.com").country).toBeNull();
});
