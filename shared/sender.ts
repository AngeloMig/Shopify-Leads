// Who outreach comes from: filled into the email and call scripts in place
// of [Your name] and the rest. Kept with the workspace's settings.
export type Sender = {
  name: string;
  company: string;
  address: string;
  /** Where a lead can see work you've done, such as your portfolio site. */
  portfolio_url: string;
};
export const emptySender: Sender = {
  name: "",
  company: "",
  address: "",
  portfolio_url: "",
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
  };
};
/** The portfolio as people read it aloud or in an email: no https://, no slash. */
export const portfolioLabel = (url: string) =>
  url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
