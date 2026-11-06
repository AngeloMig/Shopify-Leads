// Whether a store looks like an established brand with its own team or agency,
// which rarely hires an outside developer, or an independent business, which
// does. Read only from public evidence Scout already keeps; each signal says
// what was seen, so a reviewer can disagree.
import type { CatalogEvidence } from "./catalog.js";

export type BrandEvidence = {
  /** Store pages linked from the home page that a team-run brand has. */
  links?: string[];
  /** How many other language or country versions the home page declares. */
  locales?: number;
};
export type BrandSignal = { label: string; weight: number };
export type BrandSize = {
  verdict: "independent" | "possibly_established" | "likely_agency";
  signals: BrandSignal[];
};
export const brandLabel: Record<BrandSize["verdict"], string> = {
  independent: "Independent business",
  possibly_established: "Possibly an established brand",
  likely_agency: "Likely has its own team or agency",
};

const regionSubdomain =
  /^(us|usa|uk|gb|au|ca|nz|eu|de|fr|intl|int|global|international)\./;
/** Mailboxes only a business with departments has. */
const departments: Record<string, string> = {
  press: "press",
  pr: "press",
  media: "press",
  marketing: "marketing",
  wholesale: "wholesale",
  trade: "wholesale",
  stockists: "wholesale",
  b2b: "wholesale",
  export: "wholesale",
  careers: "hiring",
  jobs: "hiring",
  hr: "hiring",
  recruitment: "hiring",
  investors: "investors",
  ir: "investors",
  partnerships: "partnerships",
  partners: "partnerships",
  collabs: "partnerships",
  affiliates: "partnerships",
  hospitality: "trade accounts",
  personalshopping: "personal shopping",
};
/** Mailboxes any business has; never a person's name. */
const roles = new Set(
  `info hello hi contact contactus enquiries enquiry inquiries sales support help care
  customercare customerservice customersupport service services cs orders order shop store
  team admin office mail returns damages deliveries delivery shipping feedback complaints
  rma clients accounts billing studio bookings booking noreply no-reply webmaster`
    .split(/\s+/)
    .filter(Boolean),
);
const linkSignals: [RegExp, string][] = [
  [/\/(pages\/)?(careers|jobs|join-us|work-with-us)\b/i, "a careers page"],
  [
    /\/(pages\/)?(stockists|wholesale|retailers|where-to-buy|trade)\b/i,
    "a stockists or wholesale page",
  ],
  [/\/(pages\/)?(press|media|newsroom)\b/i, "a press page"],
  [/\/(pages\/)?(investors|investor-relations)\b/i, "an investors page"],
];

export function brandSize(input: {
  domain: string;
  /** The store's own title, such as "Official Medik8 US – Medik8-US". */
  title?: string | null;
  emails?: { email: string }[] | null;
  catalog?: CatalogEvidence | null;
  evidence?: BrandEvidence | null;
}): BrandSize {
  const signals: BrandSignal[] = [];
  const host = input.domain.toLowerCase().replace(/^www\./, "");
  if (regionSubdomain.test(host))
    signals.push({
      label: `Runs separate country stores (${host})`,
      weight: 2,
    });
  const title = input.title ?? "";
  if (/\bofficial\b/i.test(title))
    signals.push({ label: "Calls itself the official store", weight: 2 });
  else if (/[®™]/.test(title))
    signals.push({
      label: "Uses a registered trademark in its name",
      weight: 1,
    });
  const locals = [
    ...new Set(
      (input.emails ?? []).map((e) => e.email.toLowerCase().split("@")[0]),
    ),
  ];
  const brandWords = host.split(".")[0].replace(/[^a-z]/g, "");
  const teams = [
    ...new Set(
      locals.map((l) => departments[l.replace(/[^a-z]/g, "")]).filter(Boolean),
    ),
  ];
  if (teams.length)
    signals.push({
      label: `Has ${teams.join(", ")} inboxes`,
      weight: Math.min(2, teams.length),
    });
  // first.last@ or a short first name, and not the store's own name.
  const people = locals.filter(
    (l) =>
      !roles.has(l) &&
      !departments[l.replace(/[^a-z]/g, "")] &&
      /^[a-z]{3,12}([._-][a-z]{2,15})?$/.test(l) &&
      !brandWords.includes(l.replace(/[^a-z]/g, "")) &&
      !l.replace(/[^a-z]/g, "").includes(brandWords),
  );
  if (people.length >= 3)
    signals.push({
      label: `${people.length} staff mailboxes listed`,
      weight: 2,
    });
  if (input.catalog?.count_capped)
    signals.push({
      label: `Large catalog (${input.catalog.product_count}+ products)`,
      weight: 1,
    });
  const links = input.evidence?.links ?? [];
  const pages = linkSignals
    .filter(([pattern]) => links.some((l) => pattern.test(l)))
    .map(([, name]) => name);
  if (pages.length)
    signals.push({
      label: `Has ${pages.join(", ")}`,
      weight: Math.min(2, pages.length),
    });
  if ((input.evidence?.locales ?? 0) >= 3)
    signals.push({
      label: `Sells in ${input.evidence!.locales} languages or countries`,
      weight: 2,
    });
  const total = signals.reduce((n, s) => n + s.weight, 0);
  return {
    verdict:
      total >= 2
        ? "likely_agency"
        : total >= 1
          ? "possibly_established"
          : "independent",
    signals,
  };
}
