// Results: what your outreach led to, from the contact log and outcomes.
// Counts are leads, not log entries: a lead emailed three times is one
// lead emailed, so the rates read as "of the stores I emailed, how many…".
import type { ContactKind } from "./contact-log.js";

export type ResultsActivity = {
  lead_id: string;
  action: string;
  details: { kind?: unknown } | null;
  created_at: string;
};
export type ResultsLead = {
  id: string;
  industry: string | null;
  country: string | null;
  outcome: "won" | "lost" | null;
  outcome_reason: string | null;
  outcome_at: string | null;
};
export type ResultsGroup = {
  label: string;
  emailed: number;
  replied: number;
  won: number;
};
export type OutreachResults = {
  since: string | null;
  approved: number;
  emailed: number;
  called: number;
  replied: number;
  calls_booked: number;
  won: number;
  lost: number;
  emails_sent: number;
  /** Which email in the sequence the reply came after: first, follow-up, final. */
  replied_after: {
    first: number;
    follow_up: number;
    final: number;
    other: number;
  };
  by_industry: ResultsGroup[];
  by_country: ResultsGroup[];
  lost_reasons: { reason: string; count: number }[];
};

const kindOf = (a: ResultsActivity) =>
  a.action === "contact_logged" && typeof a.details?.kind === "string"
    ? (a.details.kind as ContactKind)
    : null;

/** Everything that happened on or after `since` (an ISO time; null for all time). */
export function outreachResults(
  activities: ResultsActivity[],
  leads: ResultsLead[],
  since: string | null,
): OutreachResults {
  const inRange = (at: string | null) => !!at && (!since || at >= since);
  const rows = [...activities]
    .filter((a) => inRange(a.created_at))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const sets = {
    approved: new Set<string>(),
    emailed: new Set<string>(),
    called: new Set<string>(),
    replied: new Set<string>(),
    booked: new Set<string>(),
  };
  const emailsBefore = new Map<string, number>();
  const repliedAfter = { first: 0, follow_up: 0, final: 0, other: 0 };
  let emailsSent = 0;
  for (const a of rows) {
    if (a.action === "permission_approved") sets.approved.add(a.lead_id);
    const kind = kindOf(a);
    if (!kind) continue;
    if (kind === "emailed") {
      emailsSent++;
      sets.emailed.add(a.lead_id);
      emailsBefore.set(a.lead_id, (emailsBefore.get(a.lead_id) ?? 0) + 1);
    }
    if (kind === "called" || kind === "no_answer") sets.called.add(a.lead_id);
    if (kind === "replied" && !sets.replied.has(a.lead_id)) {
      sets.replied.add(a.lead_id);
      const n = emailsBefore.get(a.lead_id) ?? 0;
      if (n === 1) repliedAfter.first++;
      else if (n === 2) repliedAfter.follow_up++;
      else if (n === 3) repliedAfter.final++;
      else repliedAfter.other++;
    }
    if (kind === "call_booked") sets.booked.add(a.lead_id);
  }
  const closed = leads.filter((l) => l.outcome && inRange(l.outcome_at));
  const won = closed.filter((l) => l.outcome === "won");
  const lost = closed.filter((l) => l.outcome === "lost");
  const reasons = new Map<string, number>();
  for (const l of lost) {
    const r = l.outcome_reason || "Not recorded";
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const byLead = new Map(leads.map((l) => [l.id, l]));
  const group = (key: (l: ResultsLead) => string | null) => {
    const groups = new Map<string, ResultsGroup>();
    const add = (id: string, field: "emailed" | "replied" | "won") => {
      const lead = byLead.get(id);
      const label = (lead && key(lead)) || "Unknown";
      const g = groups.get(label) ?? { label, emailed: 0, replied: 0, won: 0 };
      g[field]++;
      groups.set(label, g);
    };
    for (const id of sets.emailed) add(id, "emailed");
    for (const id of sets.replied) add(id, "replied");
    for (const l of won) add(l.id, "won");
    return [...groups.values()].sort(
      (a, b) =>
        b.emailed - a.emailed ||
        b.replied - a.replied ||
        a.label.localeCompare(b.label),
    );
  };
  return {
    since,
    approved: sets.approved.size,
    emailed: sets.emailed.size,
    called: sets.called.size,
    replied: sets.replied.size,
    calls_booked: sets.booked.size,
    won: won.length,
    lost: lost.length,
    emails_sent: emailsSent,
    replied_after: repliedAfter,
    by_industry: group((l) => l.industry?.split(",")[0]?.trim() || null),
    by_country: group((l) => l.country),
    lost_reasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** "12%", or "—" when there's nothing to divide by. */
export const rate = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : "—";
