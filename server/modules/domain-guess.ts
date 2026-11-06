// Before paying for a web search, try the domains a business would most
// likely own (harborroofing.com, menziesandsons.co.uk). A domain only counts
// when its page names the business and shows its phone number (or, with no
// phone listed, names its city in the title), so a namesake elsewhere isn't
// taken for theirs. Costs no credits: a DNS lookup and one page request.
import * as cheerio from "cheerio";
import { safeFetch, type SafeResponse } from "../lib/network.js";
import { nameTokens } from "../../shared/local-business.js";
import type { Country } from "../../shared/types.js";

const endings: Record<Country, string[]> = {
  US: ["com"],
  GB: ["co.uk", "com"],
  CA: ["ca", "com"],
  AU: ["com.au", "com"],
};
const companyForms = new Set(
  "llc inc ltd co company corp corporation pty limited the".split(" "),
);

/** The domains to try for a business, most likely first. At most six. */
export function domainCandidates(name: string, country: Country) {
  const { words, distinct } = nameTokens(name);
  const own = words.filter((w) => !companyForms.has(w));
  const labels = [
    own.join(""),
    own.filter((w) => w !== "and").join(""),
    distinct.join(""),
  ].filter((l) => l.length >= 5 && l.length <= 40);
  return [...new Set(labels)]
    .slice(0, 3)
    .flatMap((label) => endings[country].map((end) => `${label}.${end}`))
    .slice(0, 6);
}

const fold = (text: string) =>
  text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
/** The last seven digits of a phone number: the part every format shares. */
const phoneTail = (phone: string) => phone.replace(/\D/g, "").slice(-7);

/** Whether a fetched page is this business's own site. */
export function pageIsTheirs(
  html: string,
  business: { name: string; phone: string | null; city: string },
) {
  const $ = cheerio.load(html);
  $("script,style,noscript").remove();
  const title = fold($("title").first().text());
  const text = fold($("body").text().replace(/\s+/g, " "));
  const { words, distinct } = nameTokens(business.name);
  const marks = distinct.length ? distinct : words;
  if (
    !marks.length ||
    !marks.every((m) => text.includes(m) || title.includes(m))
  )
    return false;
  if (business.phone) {
    const tail = phoneTail(business.phone);
    if (tail.length < 7) return false;
    const numbers = (text.match(/\+?\d[\d\s().-]{6,}\d/g) ?? []).map((n) =>
      n.replace(/\D/g, ""),
    );
    const links = $("a[href^='tel:']")
      .map((_, a) => ($(a).attr("href") ?? "").replace(/\D/g, ""))
      .get();
    return [...numbers, ...links].some((n) => n.endsWith(tail));
  }
  const city = fold(business.city).split(",")[0].trim();
  return (
    city.length >= 3 &&
    text.includes(city) &&
    marks.some((m) => title.includes(m))
  );
}

type Fetcher = (url: string) => Promise<SafeResponse>;
const fetchPage: Fetcher = (url) =>
  safeFetch(url, { maxBytes: 800_000, timeout: 6000, redirects: 3 });

/** The business's own domain if one of the likely ones is theirs, else null. */
export async function guessSite(
  business: { name: string; phone: string | null; city: string },
  country: Country,
  fetcher: Fetcher = fetchPage,
): Promise<string | null> {
  const tries = domainCandidates(business.name, country).map(async (domain) => {
    try {
      const page = await fetcher(`https://${domain}/`);
      const type = page.headers["content-type"] ?? "";
      if (page.status >= 400 || (type && !type.includes("html"))) return null;
      return pageIsTheirs(page.body.toString("utf8"), business) ? domain : null;
    } catch {
      // No such domain, no HTTPS, or too slow: not found by guessing.
      return null;
    }
  });
  return (await Promise.all(tries)).find((d) => d !== null) ?? null;
}
