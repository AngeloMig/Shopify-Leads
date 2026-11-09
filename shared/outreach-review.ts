import { mailStatus, rankedEmails } from "./lead-intelligence.js";
import { countryNames, type Country, type Lead } from "./types.js";

/** The same limits the permission, suppress and country routes enforce. */
export const minRationale = 20;
export const minSuppressReason = 3;
export const minCountryNote = 10;

/** A starting guess from the web address, for the reviewer to confirm. */
export function countryFromDomain(domain: string): Country | null {
  const d = domain.toLowerCase();
  if (d.endsWith(".au")) return "AU";
  if (d.endsWith(".uk")) return "GB";
  if (d.endsWith(".ca")) return "CA";
  if (d.endsWith(".us")) return "US";
  return null;
}
/** The note to start from: .au and .ca addresses need a local business. */
export function countryNoteFromDomain(domain: string): string {
  const d = domain.toLowerCase();
  if (d.endsWith(".au"))
    return "Uses a .au web address, which needs an Australian business.";
  if (d.endsWith(".ca"))
    return "Uses a .ca web address, which needs a Canadian presence.";
  return "";
}
export type ReviewCheck = {
  id: "country" | "contact" | "email" | "platform" | "suppression";
  label: string;
  status: "pass" | "warn" | "blocked" | "unknown";
  detail: string;
  url?: string;
};
type ReviewLead = Pick<
  Lead,
  | "country"
  | "country_evidence"
  | "contact_url"
  | "emails"
  | "preferred_email"
  | "mail_checks"
  | "shopify_verified"
  | "suppressed"
>;
function emailCheck(lead: ReviewLead): ReviewCheck {
  const check = { id: "email", label: "Public email" } as const;
  const best = rankedEmails(
    lead.emails,
    lead.preferred_email,
    lead.mail_checks,
  )[0];
  if (!best)
    return {
      ...check,
      status: "warn",
      detail: "None found. Use the contact page.",
    };
  const status = mailStatus(best.email, lead.mail_checks);
  return status === "none"
    ? {
        ...check,
        status: "warn",
        detail: `${best.email} · domain takes no mail`,
        url: best.source_url,
      }
    : {
        ...check,
        status: status === "ok" ? "pass" : "unknown",
        detail: `${best.email} · ${status === "ok" ? "domain takes mail" : "mail domain not checked"}`,
        url: best.source_url,
      };
}
/** A public email whose domain doesn't refuse mail: a way to reach them. */
export function usableEmail(lead: ReviewLead) {
  const best = rankedEmails(
    lead.emails,
    lead.preferred_email,
    lead.mail_checks,
  )[0];
  return best && mailStatus(best.email, lead.mail_checks) !== "none"
    ? best.email
    : null;
}
/** What a reviewer needs to see. Only "blocked" stops an approval. */
export function reviewChecks(lead: ReviewLead): ReviewCheck[] {
  return [
    lead.country && lead.country_evidence
      ? {
          id: "country",
          label: `Country: ${countryNames[lead.country]}`,
          status: "pass",
          detail: lead.country_evidence,
        }
      : {
          id: "country",
          label: "Country",
          status: "blocked",
          detail:
            "Scout found no country on the store. Confirm it yourself, or re-audit.",
        },
    lead.contact_url
      ? {
          id: "contact",
          label: "Contact page",
          status: "pass",
          detail: lead.contact_url,
          url: lead.contact_url,
        }
      : usableEmail(lead)
        ? {
            id: "contact",
            label: "Contact page",
            status: "warn",
            detail: "None found. Use their public email instead.",
          }
        : {
            id: "contact",
            label: "Contact page",
            status: "blocked",
            detail: "No public contact page or email found.",
          },
    emailCheck(lead),
    lead.shopify_verified
      ? {
          id: "platform",
          label: "Shopify store",
          status: "pass",
          detail: "Confirmed from public evidence.",
        }
      : {
          id: "platform",
          label: "Shopify store",
          status: "warn",
          detail: "Not confirmed.",
        },
    lead.suppressed
      ? {
          id: "suppression",
          label: "Do-not-contact list",
          status: "blocked",
          detail: "This store is on the list.",
        }
      : {
          id: "suppression",
          label: "Do-not-contact list",
          status: "pass",
          detail: "Not on the list.",
        },
  ];
}
/** Everything still stopping an approval, in plain words. Empty means it can go. */
export function approvalNeeds(lead: ReviewLead, rationale: string): string[] {
  const missing = minRationale - rationale.trim().length;
  return [
    ...(lead.suppressed ? ["remove it from the do-not-contact list"] : []),
    ...(!lead.country || !lead.country_evidence ? ["country evidence"] : []),
    ...(!lead.contact_url && !usableEmail(lead)
      ? ["a public contact page or email"]
      : []),
    ...(missing > 0
      ? [
          `${missing} more ${missing === 1 ? "character" : "characters"} in your reason`,
        ]
      : []),
  ];
}
/** The next lead still open after this one, wrapping round; null when none are left. */
export function nextInQueue(
  queue: string[],
  current: string,
  isOpen: (id: string) => boolean,
) {
  const start = queue.indexOf(current);
  for (let step = 1; step < queue.length; step++) {
    const id = queue[(start + step) % queue.length];
    if (isOpen(id)) return id;
  }
  return null;
}

/**
 * A reason written from what the checks found, for the reviewer to read and
 * keep or change. Null while something still blocks an approval.
 */
export function suggestedApproval(lead: ReviewLead): string | null {
  const checks = reviewChecks(lead);
  if (checks.some((c) => c.status === "blocked")) return null;
  const best = rankedEmails(
    lead.emails,
    lead.preferred_email,
    lead.mail_checks,
  )[0];
  const parts = [
    best && mailStatus(best.email, lead.mail_checks) !== "none"
      ? `Business email ${best.email} is published on the store`
      : "Contact through the store's public contact page",
    lead.country && lead.country_evidence
      ? `Country confirmed as ${countryNames[lead.country]}`
      : null,
    lead.shopify_verified ? "Shopify store confirmed" : null,
    "Not on the do-not-contact list",
  ].filter(Boolean);
  return `${parts.join(". ")}.`;
}
/** Common reasons a store isn't one to contact, to pick instead of typing. */
export function rejectionReasons(likelyAgency: boolean): string[] {
  return [
    ...(likelyAgency
      ? ["Established brand with its own team or agency, not a fit."]
      : []),
    "Only a personal or support email; no general business contact.",
    "Outside the countries or industries I work with.",
    "Not a fit for the services I offer.",
  ];
}
