// What happened each time you got in touch with a lead, and when to follow up.
// Each entry is a lead activity ("contact_logged"); a lead's state is its
// latest entry, with the number of times you've been in touch.
export const contactKinds = [
  "emailed",
  "called",
  "no_answer",
  "replied",
  "call_booked",
] as const;
export type ContactKind = (typeof contactKinds)[number];
export const contactLabel: Record<ContactKind, string> = {
  emailed: "Emailed",
  called: "Called",
  no_answer: "No answer",
  replied: "Replied",
  call_booked: "Call booked",
};
/** Most replies come on the second or third touch, so each sets a next step. */
export const defaultFollowUpDays: Record<ContactKind, number | null> = {
  emailed: 6,
  called: 3,
  no_answer: 2,
  replied: 1,
  call_booked: null,
};
export type ContactState = {
  kind: ContactKind;
  at: string;
  /** The day to get in touch again, as YYYY-MM-DD; null for no follow-up. */
  follow_up_at: string | null;
  touches: number;
  /** How many of those touches were emails, for the three-email sequence. */
  emails?: number;
};
/**
 * The email sequence: a first email, one follow-up on day 5-7, a final
 * close-the-loop on day 12-14, then stop. `emailsBefore` is the count before
 * this one, so the first email waits 6 days, the follow-up 7, the final none.
 */
export const emailSequence = ["first", "follow_up", "final"] as const;
export type EmailStep = (typeof emailSequence)[number];
export const emailStepLabel: Record<EmailStep, string> = {
  first: "First email",
  follow_up: "Follow-up",
  final: "Final email",
};
export const nextEmailStep = (emailsSent = 0): EmailStep | null =>
  emailSequence[emailsSent] ?? null;
export function followUpDays(kind: ContactKind, emailsBefore = 0) {
  if (kind !== "emailed") return defaultFollowUpDays[kind];
  return emailsBefore === 0 ? 6 : emailsBefore === 1 ? 7 : null;
}
export type ContactRow = {
  lead_id: string;
  details: { kind?: unknown; follow_up_at?: unknown } | null;
  created_at: string;
};
/** Each lead's latest contact, from activity rows in any order. */
export function readContactLog(rows: ContactRow[]) {
  const byLead = new Map<string, ContactState>();
  const sorted = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  for (const row of sorted) {
    const kind = row.details?.kind;
    if (!contactKinds.includes(kind as ContactKind)) continue;
    const follow = row.details?.follow_up_at;
    byLead.set(row.lead_id, {
      kind: kind as ContactKind,
      at: row.created_at,
      follow_up_at:
        typeof follow === "string" && /^\d{4}-\d{2}-\d{2}$/.test(follow)
          ? follow
          : null,
      touches: (byLead.get(row.lead_id)?.touches ?? 0) + 1,
      emails:
        (byLead.get(row.lead_id)?.emails ?? 0) + (kind === "emailed" ? 1 : 0),
    });
  }
  return byLead;
}
/** Today in the user's own time zone, as YYYY-MM-DD. */
export const localDay = (at = new Date()) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
export const addDays = (day: string, days: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + days));
};
/** A follow-up that's today or overdue, on a lead that's still open. */
export const isDue = (
  lead: { contact?: ContactState | null; outcome?: string | null },
  today = localDay(),
) =>
  !lead.outcome &&
  !!lead.contact?.follow_up_at &&
  lead.contact.follow_up_at <= today;
/** "Follow up today", "Follow up in 3 days", "2 days overdue". */
export function followUpLabel(day: string, today = localDay()) {
  const diff = Math.round(
    (Date.parse(`${day}T00:00:00`) - Date.parse(`${today}T00:00:00`)) /
      86400000,
  );
  if (diff === 0) return "Follow up today";
  if (diff < 0)
    return `Follow-up ${-diff} ${diff === -1 ? "day" : "days"} overdue`;
  if (diff === 1) return "Follow up tomorrow";
  return `Follow up in ${diff} days`;
}

/** The person to write to at a lead, set by hand from their About or Team page. */
export type ContactPerson = { name: string; role: string };
/** Each lead's latest "contact_person" activity; a blank name clears it. */
export function readContactPeople(
  rows: {
    lead_id: string;
    details: { name?: unknown; role?: unknown } | null;
    created_at: string;
  }[],
) {
  const byLead = new Map<string, ContactPerson | null>();
  for (const row of [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )) {
    const name =
      typeof row.details?.name === "string" ? row.details.name.trim() : "";
    const role =
      typeof row.details?.role === "string" ? row.details.role.trim() : "";
    byLead.set(row.lead_id, name ? { name, role } : null);
  }
  return byLead;
}
