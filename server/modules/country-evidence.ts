import type { CheerioAPI } from "cheerio";
import type { Country } from "../../shared/types.js";

/** Explicit business addresses only. Shipping markets/currency/domain are not proof. */
export function publicBusinessCountry($: CheerioAPI, url: string) {
  const countries: { country: Country; name: RegExp; postal: RegExp }[] = [
    {
      country: "US",
      name: /\bUnited States(?: of America)?\b|\bUSA\b/i,
      postal: /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i,
    },
    {
      country: "GB",
      name: /\bUnited Kingdom\b|\bUK\b/i,
      postal: /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i,
    },
    {
      country: "CA",
      name: /\bCanada\b/i,
      postal: /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i,
    },
    {
      country: "AU",
      name: /\bAustralia\b/i,
      postal: /\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+\d{4}\b/i,
    },
  ];
  const hits: { country: Country; country_evidence: string }[] = [];
  $(
    "address, .business-address, .store-address, [data-business-address], p, li",
  ).each((_, element) => {
    const node = $(element);
    if (
      node.closest(
        "[hidden],[aria-hidden='true'],script,style,template,noscript",
      ).length
    )
      return;
    const copy = node.clone();
    copy
      .find("script,style,template,noscript,[hidden],[aria-hidden='true']")
      .remove();
    const text = copy
      .find("*")
      .addBack()
      .contents()
      .filter((_, node) => node.type === "text")
      .map((_, node) => $(node).text())
      .get()
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text.length > 650) return;
    const semantic = node.is(
      "address,.business-address,.store-address,[data-business-address]",
    );
    const businessLabel =
      /\b(?:our (?:store|shop|office|business)|visit us|business address|registered office|head office|headquarters|store address)\b/i.test(
        text,
      );
    if (!semantic && !businessLabel) return;
    // Reject shipping/return/customer addresses even if their format is valid.
    if (
      /\b(?:ship(?:ping)? to|deliver(?:y|ies)? to|shipping address|billing address|return(?:s)? address|warehouse|customer address)\b/i.test(
        text,
      )
    )
      return;
    if (
      !/\b\d{1,6}\s+[\p{L}\d .'-]{2,70}\b(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|place|pl|crescent|court|ct|rue)\b/iu.test(
        text,
      )
    )
      return;
    const named = countries.filter((entry) => entry.name.test(text));
    if (named.length !== 1 || !named[0].postal.test(text)) return;
    hits.push({
      country: named[0].country,
      country_evidence: `${url}: public business address: ${text}`,
    });
  });
  // Conflicting public offices need human review rather than guessing HQ.
  if (new Set(hits.map((hit) => hit.country)).size !== 1) return null;
  return hits[0] ?? null;
}
