import * as cheerio from "cheerio";
import { randomUUID } from "node:crypto";
import { publicBusinessCountry } from "./country-evidence.js";
import type { Finding, Country, PublicEmail } from "../../shared/types.js";
export type PageEvidence = {
  url: string;
  kind: string;
  title: string;
  description: string;
  h1: string[];
  canonical: string | null;
  robots: string | null;
  schemas: string[];
  images: {
    url: string;
    alt: string | null;
    width: string | null;
    height: string | null;
    srcset: boolean;
    loading: string | null;
  }[];
  links: string[];
  contact_url: string | null;
  emails: PublicEmail[];
  country: Country | null;
  country_evidence: string | null;
  shopify: string[];
  activity: { accessible: boolean; products: boolean; cart: boolean };
  technologies: { vendor: string; evidence: string }[];
  findings: Finding[];
};
export function inspectHtml(
  html: string,
  url: string,
  kind = "homepage",
): PageEvidence {
  const $ = cheerio.load(html);
  const findings: Finding[] = [];
  const add = (
    category: string,
    title: string,
    evidence: string,
    recommendation: string,
    severity: Finding["severity"] = "medium",
    observation: Finding["kind"] = "verified",
  ) =>
    findings.push({
      id: randomUUID(),
      category,
      url,
      title,
      evidence,
      severity,
      confidence: observation === "verified" ? "high" : "medium",
      recommendation,
      kind: observation,
    });
  const title = $("title").first().text().trim();
  const description =
    $('meta[name="description"]').attr("content")?.trim() ?? "";
  const h1 = $("h1")
    .map((_, e) => $(e).text().trim())
    .get();
  if (!title)
    add(
      "SEO",
      "Missing page title",
      "No non-empty <title> element in returned HTML.",
      "Add a descriptive, page-specific title.",
    );
  if (!description)
    add(
      "SEO",
      "Missing meta description",
      "No non-empty meta description in returned HTML.",
      "Write a useful, page-specific meta description.",
      "low",
    );
  if (h1.length !== 1)
    add(
      "SEO",
      h1.length ? "Multiple H1 headings" : "Missing H1 heading",
      `${h1.length} H1 elements in returned HTML.`,
      "Review the page heading hierarchy.",
      "low",
    );
  const canonical = $('link[rel="canonical"]').attr("href") ?? null;
  const robots = $('meta[name="robots"]').attr("content") ?? null;
  if (robots?.match(/noindex/i))
    add(
      "SEO",
      "Noindex directive observed",
      `meta robots="${robots}"`,
      "Confirm whether this public page should be indexable. This does not verify Google index status.",
    );
  const schemas: string[] = [];
  let country: Country | null = null;
  let country_evidence: string | null = null;
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const o = obj as Record<string, unknown>;
    if (o["@type"]) schemas.push(String(o["@type"]));
    const type = String(o["@type"] ?? "");
    const business = /Organization|LocalBusiness|Store|Corporation/.test(type);
    const address =
      business && o.address && typeof o.address === "object"
        ? (o.address as Record<string, unknown>)
        : null;
    const ownUrl = typeof o.url === "string" ? o.url : null;
    let sameBusiness = true;
    if (ownUrl) {
      try {
        sameBusiness =
          new URL(ownUrl, url).hostname.replace(/^www\./, "") ===
          new URL(url).hostname.replace(/^www\./, "");
      } catch {
        sameBusiness = false;
      }
    }
    if (address?.addressCountry && sameBusiness) {
      const value = address.addressCountry;
      const raw =
        typeof value === "object"
          ? (value as { name?: string }).name
          : String(value);
      const cc = (
        {
          US: "US",
          USA: "US",
          "United States": "US",
          GB: "GB",
          UK: "GB",
          "United Kingdom": "GB",
          CA: "CA",
          Canada: "CA",
          AU: "AU",
          Australia: "AU",
        } as Record<string, Country>
      )[raw ?? ""];
      if (cc) {
        country = cc;
        country_evidence = `${url}: JSON-LD ${type} business addressCountry=${raw}`;
      }
    }
    Object.values(o)
      .filter((v) => v && typeof v === "object")
      .forEach(walk);
  };
  $('script[type="application/ld+json"]').each((_, e) => {
    try {
      walk(JSON.parse($(e).text()));
    } catch {
      add(
        "SEO",
        "Invalid JSON-LD",
        "A public application/ld+json block could not be parsed.",
        "Validate the structured-data JSON syntax.",
        "low",
      );
    }
  });
  if (!country) {
    const address = publicBusinessCountry($, url);
    if (address) {
      country = address.country;
      country_evidence = address.country_evidence;
    }
  }
  const links = [
    ...new Set(
      $("a[href]")
        .map((_, e) => {
          try {
            const u = new URL($(e).attr("href")!, url);
            return u.origin === new URL(url).origin &&
              u.protocol.startsWith("http")
              ? u.href.split("#")[0]
              : null;
          } catch {
            return null;
          }
        })
        .get()
        .filter((x): x is string => !!x),
    ),
  ];
  // Only explicit public addresses: never scripts, guessed patterns, or mailto
  // query parameters (which can contain recipients unrelated to this business).
  const addresses = new Set<string>();
  const addEmail = (value: string) => {
    const email = value.trim().toLowerCase();
    if (
      email.length <= 254 &&
      /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,24}$/i.test(
        email,
      ) &&
      !/\.{2}|(?:^|@)(?:example|yourdomain|domain)\.|@.*\.example$|^(?:noreply|no-reply)@/i.test(
        email,
      )
    )
      addresses.add(email);
  };
  $('a[href^="mailto:" i]').each((_, element) => {
    try {
      const recipients = decodeURIComponent(
        $(element).attr("href")!.slice(7).split("?")[0],
      );
      recipients.split(/[,;]/).forEach(addEmail);
    } catch {
      /* Malformed public links are not contact evidence. */
    }
  });
  // Cloudflare publishes the address as XOR-encoded bytes for its browser
  // decoder. Read that explicit public contact evidence without running scripts.
  $('[data-cfemail], a[href*="/cdn-cgi/l/email-protection#"]').each(
    (_, element) => {
      if (
        $(element).closest('[hidden],[aria-hidden="true"],script,template')
          .length
      )
        return;
      const encoded =
        $(element).attr("data-cfemail") ??
        $(element).attr("href")?.split("#")[1] ??
        "";
      if (!/^(?:[a-f0-9]{2}){4,255}$/i.test(encoded)) return;
      const key = parseInt(encoded.slice(0, 2), 16);
      let decoded = "";
      for (let i = 2; i < encoded.length; i += 2)
        decoded += String.fromCharCode(
          parseInt(encoded.slice(i, i + 2), 16) ^ key,
        );
      addEmail(decoded);
    },
  );
  const visible = $("body").clone();
  visible
    .find("script,style,noscript,template,svg,[hidden],[aria-hidden='true']")
    .remove();
  const publicText = visible
    .find("*")
    .addBack()
    .contents()
    .filter((_, node) => node.type === "text")
    .map((_, node) => $(node).text())
    .get()
    .join(" ");
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  for (const match of publicText.matchAll(
    /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,24}/gi,
  )) {
    const email = match[0].replace(/\.+$/, "");
    const domain = email.split("@")[1].toLowerCase();
    // Unlinked third-party text can belong to an app vendor, not the merchant.
    if (domain === host || domain.endsWith(`.${host}`)) addEmail(email);
  }
  // A merchant may publish its parent-brand mailbox on a different domain.
  // Require an explicit email/contact label on a contact page, not arbitrary
  // third-party text, reviews, forms, or embedded application data.
  if (
    (kind === "contact" &&
      /contact|customer care|customer service|returns|refund/i.test(
        `${title} ${h1.join(" ")}`,
      )) ||
    /\/(?:pages\/)?(?:contact|customer[-_]?(?:care|service))(?:[-/]|$)/i.test(
      new URL(url).pathname,
    )
  ) {
    visible.find("p,li,dd,address").each((_, element) => {
      const block = $(element);
      if (
        block.closest(
          'form,blockquote,[class*="review"],[class*="comment"],[class*="testimonial"]',
        ).length
      )
        return;
      const text = block.text().trim();
      if (text.length > 600) return;
      for (const match of text.matchAll(
        /(?:\be-?mail\s*:\s*|\be-?mail\s+us(?:\s+at)?\s+|\bcontact\s+us\s+(?:at|on)\s*:?\s*)([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,24})/gi,
      ))
        addEmail(match[1].replace(/\.+$/, ""));
    });
  }
  const images = $("img")
    .map((_, e) => {
      const el = $(e);
      let src = el.attr("src") ?? "";
      try {
        src = new URL(src, url).href;
      } catch {
        /* retained as observed */
      }
      return {
        url: src,
        alt: el.attr("alt") ?? null,
        width: el.attr("width") ?? null,
        height: el.attr("height") ?? null,
        srcset: !!el.attr("srcset"),
        loading: el.attr("loading") ?? null,
      };
    })
    .get();
  const missingAlt = images.filter((i) => i.alt === null);
  if (missingAlt.length)
    add(
      "Images",
      "Images without alt attributes",
      `${missingAlt.length}/${images.length} images have no alt attribute. Examples: ${missingAlt
        .slice(0, 3)
        .map((i) => i.url)
        .join(", ")}`,
      "Add descriptive alt text to informative images and empty alt attributes to decorative images.",
    );
  const noDimensions = images.filter((i) => !i.width || !i.height);
  if (noDimensions.length)
    add(
      "Images",
      "Image dimensions need review",
      `${noDimensions.length} image elements lack HTML width or height; CSS sizing was not verified.`,
      "Check reserved aspect ratios before changing sizing to prevent layout shifts.",
      "low",
      "hypothesis",
    );
  const scripts = $("script[src]")
    .map((_, e) => $(e).attr("src")!)
    .get();
  const duplicate = scripts.filter((v, i) => scripts.indexOf(v) !== i);
  if (duplicate.length)
    add(
      "Frontend",
      "Duplicate script references",
      `Repeated src attributes: ${[...new Set(duplicate)].join(", ")}`,
      "Review duplicate script inclusion and confirm behavior before removal.",
    );
  const indicators = [
    ["Shopify global", /Shopify\.(shop|theme|routes)\s*[=:]/],
    [
      "Shopify asset CDN",
      /cdn\.shopify\.com\/s\/|\/cdn\/shop\/(?:files|t|products)\//,
    ],
    ["Shopify cart route", /\/cart\/add/],
  ]
    .filter(([, pattern]) => (pattern as RegExp).test(html))
    .map(([label]) => String(label));
  const technologies = [
    ["Klaviyo", /static\.klaviyo\.com|a\.klaviyo\.com/],
    ["HubSpot", /js\.hs-scripts\.com|js\.hsforms\.net/],
    ["Gorgias", /gorgias\.chat|gorgias-chat/],
    ["Google Tag Manager", /googletagmanager\.com\/gtm\.js/],
    ["Google Analytics", /googletagmanager\.com\/gtag\/js/],
    ["Meta Pixel", /connect\.facebook\.net\/.*fbevents/],
  ].flatMap(([vendor, pattern]) => {
    const match = html.match(pattern as RegExp);
    return match ? [{ vendor: String(vendor), evidence: match[0] }] : [];
  });
  const products = links.some((l) =>
    new URL(l).pathname.includes("/products/"),
  );
  const cart =
    $('form[action*="/cart/add"],button[name="add"],input[name="add"]').length >
    0;
  if (kind === "product" && !cart)
    add(
      "CRO",
      "Purchase control needs review",
      "No standard Shopify add-to-cart control was found in returned HTML. JavaScript rendering was not verified.",
      "Inspect the rendered product purchase flow before recommending changes.",
      "medium",
      "hypothesis",
    );
  return {
    url,
    kind,
    title,
    description,
    h1,
    canonical,
    robots,
    schemas: [...new Set(schemas)],
    images,
    links,
    contact_url:
      links.find((l) => /\/((pages\/)?contact)/i.test(new URL(l).pathname)) ??
      null,
    emails: [...addresses]
      .slice(0, 10)
      .map((email) => ({ email, source_url: url })),
    country,
    country_evidence,
    shopify: indicators,
    activity: { accessible: true, products, cart },
    technologies,
    findings,
  };
}
