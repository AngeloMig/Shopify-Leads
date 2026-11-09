// Who outreach comes from: filled into the email and call scripts in place
// of [Your name] and the rest. Kept with the workspace's settings.
export type Sender = {
  name: string;
  company: string;
  address: string;
  /** Where a lead can see work you've done, such as your portfolio site. */
  portfolio_url: string;
  /** How a store owner reaches you from the report and the email. */
  email: string;
  phone: string;
  /** A calendar link (Cal.com, Calendly) for booking the first call. */
  booking_url: string;
  /** The one first step you sell, e.g. "Mobile product-page review". */
  offer_name: string;
  /** What it covers and what they get, in a sentence. */
  offer_scope: string;
  /** Optional, e.g. "From $450" or "Free". Left out when blank. */
  offer_price: string;
  /** Projects to point to, matched to each store by industry. */
  work: CaseStudy[];
};
export type CaseStudy = { title: string; url: string; industry: string };
export const maxCaseStudies = 8;
export const emptySender: Sender = {
  name: "",
  company: "",
  address: "",
  portfolio_url: "",
  email: "",
  phone: "",
  booking_url: "",
  offer_name: "",
  offer_scope: "",
  offer_price: "",
  work: [],
};
export const readSender = (value: unknown): Sender => {
  const v = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const text = (k: keyof Sender) =>
    typeof v[k] === "string" ? (v[k] as string).trim() : "";
  return {
    name: text("name"),
    company: text("company"),
    address: text("address"),
    portfolio_url: text("portfolio_url"),
    email: text("email"),
    phone: text("phone"),
    booking_url: text("booking_url"),
    offer_name: text("offer_name"),
    offer_scope: text("offer_scope"),
    offer_price: text("offer_price"),
    work: (Array.isArray(v.work) ? v.work : [])
      .map((w) => {
        const o = (w && typeof w === "object" ? w : {}) as Record<
          string,
          unknown
        >;
        const t = (k: string) =>
          typeof o[k] === "string" ? (o[k] as string).trim() : "";
        return { title: t("title"), url: t("url"), industry: t("industry") };
      })
      .filter((w) => w.title && /^https?:\/\//i.test(w.url))
      .slice(0, maxCaseStudies),
  };
};
/** The project closest to a store: same industry first, else none. */
export const matchingWork = (sender: Sender, industry: string) =>
  sender.work.find((w) => w.industry && w.industry === industry) ?? null;
/** The portfolio as people read it aloud or in an email: no https://, no slash. */
export const portfolioLabel = (url: string) =>
  url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
/** The offer as one line: "Mobile product-page review (from $450)". */
export const offerLine = (sender: Sender) =>
  sender.offer_name
    ? `${sender.offer_name}${sender.offer_price ? ` (${sender.offer_price.charAt(0).toLowerCase()}${sender.offer_price.slice(1)})` : ""}`
    : "";
/** How to reach you, in the order people use them. */
export const contactLines = (sender: Sender) =>
  [
    sender.email,
    sender.phone,
    sender.booking_url
      ? `Book a call: ${portfolioLabel(sender.booking_url)}`
      : "",
  ].filter(Boolean);
