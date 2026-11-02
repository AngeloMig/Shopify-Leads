import { Resolver } from "node:dns/promises";
import type { MailChecks, MailStatus } from "../../shared/lead-intelligence.js";

type Lookup = Pick<Resolver, "resolveMx" | "resolve4" | "resolve6">;
const missing = (error: unknown) =>
  ["ENODATA", "ENOTFOUND"].includes((error as { code?: string })?.code ?? "");
/**
 * Whether a domain can receive mail at all. This never contacts a mail server, so
 * it can't confirm a mailbox exists. Lookup failures stay unknown, never "none".
 */
export async function mailDomainStatus(
  domain: string,
  dns: Lookup,
): Promise<MailStatus> {
  try {
    const records = await dns.resolveMx(domain);
    // A lone empty exchange is the "null MX" record: this domain takes no mail.
    if (records.length === 1 && ["", "."].includes(records[0].exchange))
      return "none";
    if (records.length) return "ok";
  } catch (error) {
    if (!missing(error)) return "unknown";
  }
  // With no MX record, mail standards fall back to the domain's own address.
  for (const lookup of [() => dns.resolve4(domain), () => dns.resolve6(domain)])
    try {
      if ((await lookup()).length) return "ok";
    } catch (error) {
      if (!missing(error)) return "unknown";
    }
  return "none";
}
export async function checkMailDomains(
  emails: { email: string }[],
  dns: Lookup = new Resolver({ timeout: 5000, tries: 2 }),
): Promise<MailChecks> {
  const domains = [
    ...new Set(emails.map((e) => e.email.split("@")[1]?.toLowerCase())),
  ].filter(Boolean);
  return Object.fromEntries(
    await Promise.all(
      domains.map(
        async (domain) =>
          [domain, await mailDomainStatus(domain, dns)] as const,
      ),
    ),
  );
}
