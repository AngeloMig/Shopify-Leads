// The one thing to do next on a lead, in plain words, with one button.
// Everything else on the lead panel supports this.
import {
  emailStepLabel,
  followUpLabel,
  isDue,
  localDay,
  nextEmailStep,
} from "./contact-log.js";
import type { Lead } from "./types.js";

export type NextAction =
  | "review"
  | "retest"
  | "email"
  | "call_booked"
  | "lost_no_response"
  | "before_after"
  | "reaudit"
  | "find_contact"
  | null;
export type NextStep = {
  title: string;
  detail: string;
  action: NextAction;
  label: string;
};

export function leadNextStep(
  lead: Pick<
    Lead,
    | "suppressed"
    | "outcome"
    | "outcome_reason"
    | "permission"
    | "contact"
    | "emails"
    | "contact_url"
  >,
  o: { stale: boolean; completedAudits: number; today?: string },
): NextStep {
  const today = o.today ?? localDay();
  const c = lead.contact ?? null;
  const sent = c?.emails ?? 0;
  const step = nextEmailStep(sent);
  if (lead.suppressed)
    return {
      title: "Don't contact this store",
      detail: "It's on the do-not-contact list.",
      action: null,
      label: "",
    };
  if (lead.outcome === "won")
    return o.completedAudits >= 2
      ? {
          title: "Send them the before and after",
          detail:
            "The same tests before and after your work, with what was fixed. It doubles as a case study.",
          action: "before_after",
          label: "Before and after",
        }
      : {
          title: "Re-audit once your work is live",
          detail:
            "Then you can send a before-and-after report with what changed.",
          action: "reaudit",
          label: "Re-audit store",
        };
  if (lead.outcome === "lost")
    return {
      title: "Closed",
      detail: `Marked lost${lead.outcome_reason ? `: ${lead.outcome_reason}` : ""}.`,
      action: null,
      label: "",
    };
  if (o.stale)
    return {
      title: "Re-test before you get in touch",
      detail:
        "This audit is over 30 days old. Scores move, so quote numbers they can check today.",
      action: "retest",
      label: "Re-test now",
    };
  if (lead.permission !== "approved")
    return lead.permission === "rejected"
      ? {
          title: "Not approved for outreach",
          detail: "Review it again if something has changed.",
          action: "review",
          label: "Review again",
        }
      : {
          title: "Review this store",
          detail:
            "Check the evidence and the contact, then approve it for outreach.",
          action: "review",
          label: "Review now",
        };
  if (!lead.emails?.length && !lead.contact_url)
    return {
      title: "Find a way to reach them",
      detail: "No public email or contact page was found on their site.",
      action: "find_contact",
      label: "Visit storefront",
    };
  if (c?.kind === "replied")
    return {
      title: "They replied: answer and book a call",
      detail: "Log the call once it's booked.",
      action: "call_booked",
      label: "Mark call booked",
    };
  if (c?.kind === "call_booked")
    return {
      title: "Call booked",
      detail: "After the call, mark this lead won or lost.",
      action: null,
      label: "",
    };
  if (!step)
    return {
      title: "No reply after three emails",
      detail: "Close it as lost so it stops coming back.",
      action: "lost_no_response",
      label: "Mark lost · No response",
    };
  if (!c || isDue(lead, today))
    return {
      title: `Send the ${emailStepLabel[step].toLowerCase()}`,
      detail:
        step === "first"
          ? "One finding, one first step, and how to reach you. It's written for you."
          : "Reply in the same thread as your first email.",
      action: "email",
      label:
        step === "first"
          ? "Write the email"
          : `Write the ${emailStepLabel[step].toLowerCase()}`,
    };
  return {
    title: "Waiting for a reply",
    detail: c.follow_up_at
      ? `${followUpLabel(c.follow_up_at, today)}: the ${emailStepLabel[step].toLowerCase()}.`
      : "Log what happens when they reply.",
    action: null,
    label: "",
  };
}
