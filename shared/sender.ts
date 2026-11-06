// Who outreach comes from: filled into the email and call scripts in place
// of [Your name] and the rest. Kept with the workspace's settings.
export type Sender = {
  name: string;
  company: string;
  address: string;
  /** Where a lead can see work you've done, such as your portfolio site. */
  portfolio_url: string;
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
