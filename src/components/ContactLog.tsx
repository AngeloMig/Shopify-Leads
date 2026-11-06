import { useState } from "react";
import { CalendarClock } from "lucide-react";
import {
  addDays,
  contactKinds,
  contactLabel,
  defaultFollowUpDays,
  followUpLabel,
  localDay,
  type ContactKind,
  type ContactState,
} from "../../shared/contact-log";
import { formatDate } from "../lib";

const followChoices = [
  [1, "Tomorrow"],
  [2, "In 2 days"],
  [3, "In 3 days"],
  [7, "In a week"],
  [14, "In 2 weeks"],
] as const;

/** Log each time you get in touch, and set when to follow up. */
export function ContactLog({
  contact,
  closed,
  busy,
  onLog,
}: {
  contact: ContactState | null;
  closed: boolean;
  busy: boolean;
  onLog: (contact: Omit<ContactState, "touches">) => void;
}) {
  const [days, setDays] = useState<number | "none" | "auto">("auto");
  const log = (kind: ContactKind) => {
    const wait = days === "auto" ? defaultFollowUpDays[kind] : days;
    onLog({
      kind,
      at: new Date().toISOString(),
      follow_up_at:
        wait === "none" || wait === null ? null : addDays(localDay(), wait),
    });
    setDays("auto");
  };
  return (
    <section className="lead-contact-log" aria-labelledby="contact-log-title">
      <h3 id="contact-log-title">Contact log</h3>
      <p className="muted" role="status">
        {contact ? (
          <>
            {contactLabel[contact.kind]} {formatDate(contact.at, true)} ·{" "}
            {contact.touches} {contact.touches === 1 ? "touch" : "touches"}
            {contact.follow_up_at && !closed && (
              <>
                {" · "}
                <strong>{followUpLabel(contact.follow_up_at)}</strong>
              </>
            )}
          </>
        ) : (
          "Not contacted yet. Log each email or call to get follow-up reminders."
        )}
      </p>
      <div className="lead-contact-actions" aria-label="Log what happened">
        {contactKinds.map((kind) => (
          <button
            type="button"
            key={kind}
            className="lead-contact-kind"
            data-kind={kind}
            disabled={busy || closed}
            onClick={() => log(kind)}
          >
            {contactLabel[kind]}
          </button>
        ))}
      </div>
      <label className="lead-contact-follow">
        <CalendarClock size={14} aria-hidden="true" />
        <span>Follow up</span>
        <select
          value={String(days)}
          disabled={busy || closed}
          onChange={(e) =>
            setDays(
              e.target.value === "auto" || e.target.value === "none"
                ? e.target.value
                : Number(e.target.value),
            )
          }
        >
          <option value="auto">Suggested for what happened</option>
          {followChoices.map(([n, label]) => (
            <option key={n} value={n}>
              {label}
            </option>
          ))}
          <option value="none">No follow-up</option>
        </select>
      </label>
    </section>
  );
}
