import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { leadIntelligence } from "../../shared/lead-intelligence";
import { leadScoreFor } from "../../shared/lead-score";
import {
  approvalNeeds,
  countryFromDomain,
  countryNoteFromDomain,
  minCountryNote,
  minRationale,
  minSuppressReason,
  nextInQueue,
  rejectionReasons,
  reviewChecks,
  suggestedApproval,
  type ReviewCheck,
} from "../../shared/outreach-review";
import { countryNames, type Country, type Lead } from "../../shared/types";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

const checkIcons = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  blocked: XCircle,
  unknown: Circle,
};
const decisionLabels = {
  approved: "Approved for outreach",
  rejected: "Marked not eligible",
  unknown: "Waiting for your decision",
};
function CheckRow({
  check,
  children,
}: {
  check: ReviewCheck;
  children?: ReactNode;
}) {
  const Icon = checkIcons[check.status];
  return (
    <li className={`review-check ${check.status}`}>
      <Icon size={15} aria-hidden="true" />
      <div>
        <strong>{check.label}</strong>
        {check.url ? (
          <a href={check.url} target="_blank" rel="noreferrer">
            {check.detail}
            <ExternalLink size={11} />
          </a>
        ) : (
          <span>{check.detail}</span>
        )}
        {children}
      </div>
    </li>
  );
}
/** The override for a missing country: you say which, and where you saw it. */
function CountryConfirm({
  lead,
  onConfirm,
}: {
  lead: Lead;
  onConfirm: (lead: Lead, country: Country, note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [country, setCountry] = useState<Country | "">(
      countryFromDomain(lead.domain) ?? "",
    ),
    [note, setNote] = useState(countryNoteFromDomain(lead.domain)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!open)
    return (
      <button
        type="button"
        className="text-button review-country-open"
        onClick={() => setOpen(true)}
      >
        Confirm the country
      </button>
    );
  const ready = !!country && note.trim().length >= minCountryNote && !busy;
  return (
    <form
      className="review-country"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        setError("");
        try {
          await onConfirm(lead, country as Country, note.trim());
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "The country wasn't saved.",
          );
          setBusy(false);
        }
      }}
    >
      <label className="field-label">
        Country
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value as Country)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {(Object.keys(countryNames) as Country[]).map((c) => (
            <option key={c} value={c}>
              {countryNames[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        Where you saw it
        <input
          value={note}
          maxLength={500}
          placeholder="Example: Sydney address on the contact page"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button size="sm" type="submit" disabled={!ready}>
          {busy && <LoaderCircle size={14} className="spin" />}
          Save country
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
/** Records one human decision at a time. Nothing here sends a message. */
export function OutreachReview({
  leads,
  queue,
  startId,
  demo,
  onReview,
  onSuppress,
  onConfirmCountry,
  onOpenFull,
  onClose,
}: {
  leads: Lead[];
  queue: string[];
  startId: string;
  demo: boolean;
  onReview: (
    lead: Lead,
    status: "approved" | "rejected",
    rationale: string,
  ) => Promise<void>;
  onSuppress: (lead: Lead, reason: string) => Promise<void>;
  onConfirmCountry: (
    lead: Lead,
    country: Country,
    note: string,
  ) => Promise<void>;
  onOpenFull: (lead: Lead) => void;
  onClose: () => void;
}) {
  const [currentId, setCurrentId] = useState(startId),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [decided, setDecided] = useState<string[]>([]),
    [busy, setBusy] = useState<"approved" | "rejected" | "suppress" | null>(
      null,
    ),
    [confirmSuppress, setConfirmSuppress] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  const lead = leads.find((l) => l.id === currentId);
  // Keys work anywhere in the review, as soon as each store opens.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const listen = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, []);
  const position = queue.indexOf(currentId);
  const move = (step: number) => {
    setError("");
    setConfirmSuppress(false);
    setCurrentId(queue[(position + step + queue.length) % queue.length]);
  };
  // Nothing to act on once the queue is done.
  keyHandler.current = () => {};
  if (done || !lead)
    return (
      <Dialog
        open
        onOpenChange={(open) => !open && onClose()}
        title="All caught up"
        description={
          lead
            ? `You decided ${decided.length} of ${queue.length} in this queue.`
            : "This lead is no longer available."
        }
        className="review-dialog"
      >
        <div className="review-done">
          <ShieldCheck size={26} aria-hidden="true" />
          <p>Scout never sends messages. Outreach stays with you.</p>
          <Button onClick={onClose}>Close</Button>
        </div>
      </Dialog>
    );
  const rationale = drafts[lead.id] ?? "";
  const reasonLength = rationale.trim().length;
  const checks = reviewChecks(lead);
  const needs = approvalNeeds(lead, rationale);
  const intelligence = leadIntelligence(lead);
  const scored = leadScoreFor(lead);
  const score = scored.researchScore;
  const agency = scored.brand?.verdict === "likely_agency";
  const suggestion = suggestedApproval(lead);
  const setReason = (text: string) =>
    setDrafts((d) => ({ ...d, [lead.id]: text }));
  const canApprove = !busy && needs.length === 0;
  const canReject = !busy && reasonLength >= minRationale;
  async function decide(
    kind: "approved" | "rejected" | "suppress",
    run: () => Promise<void>,
  ) {
    setError("");
    setBusy(kind);
    try {
      await run();
      setConfirmSuppress(false);
      const closed = [...decided, lead!.id];
      setDecided(closed);
      const next = nextInQueue(
        queue,
        lead!.id,
        (id) =>
          !closed.includes(id) &&
          leads.some(
            (l) => l.id === id && l.permission === "unknown" && !l.suppressed,
          ),
      );
      if (next) setCurrentId(next);
      else if (queue.length === 1) onClose();
      else setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The decision wasn't saved.");
    } finally {
      setBusy(null);
    }
  }
  keyHandler.current = (e: KeyboardEvent) => {
    const typing = (e.target as HTMLElement | null)?.matches?.(
      "textarea,input,select",
    );
    // Cmd/Ctrl+Enter approves from the reason box too.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      approve();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (queue.length > 1 && (key === "arrowleft" || key === "arrowright"))
      move(key === "arrowleft" ? -1 : 1);
    else if (key === "u" && suggestion) setReason(suggestion);
    else if (key === "a") approve();
    else if (key === "n") reject();
    else if (key === "s" && queue.length > 1) move(1);
    else return;
    e.preventDefault();
  };
  const approve = () =>
    canApprove &&
    void decide("approved", () => onReview(lead, "approved", rationale));
  const reject = () =>
    canReject &&
    void decide("rejected", () => onReview(lead, "rejected", rationale));
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={lead.name}
      description={`${lead.domain} · ${demo ? "Fictional sample prospect" : "Outreach review"}`}
      className="review-dialog"
    >
      <div className="review-body">
        <div className="review-bar">
          <span>
            {[
              lead.country && countryNames[lead.country],
              lead.industry,
              `Score ${score}`,
              agency ? "Has its own team" : null,
              intelligence.main,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {queue.length > 1 && (
            <nav aria-label="Review queue">
              <span role="status" aria-live="polite">
                {position + 1} of {queue.length}
              </span>
              <button
                className="icon-button"
                aria-label="Previous lead"
                onClick={() => move(-1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Next lead"
                onClick={() => move(1)}
              >
                <ChevronRight size={16} />
              </button>
            </nav>
          )}
        </div>
        <div className="review-columns">
          <section aria-labelledby="review-checks-title">
            <h3 id="review-checks-title">Checks</h3>
            <ul>
              {checks.map((check) => (
                <CheckRow check={check} key={check.id}>
                  {check.id === "country" && check.status === "blocked" && (
                    <CountryConfirm
                      key={lead.id}
                      lead={lead}
                      onConfirm={onConfirmCountry}
                    />
                  )}
                </CheckRow>
              ))}
            </ul>
            <details className="review-why">
              <summary>Why this lead</summary>
              <p>{intelligence.reason}</p>
              <p>Possible work: {intelligence.service}</p>
              <button className="text-button" onClick={() => onOpenFull(lead)}>
                Full lead details
              </button>
            </details>
          </section>
          <section aria-labelledby="review-decision-title">
            <h3 id="review-decision-title">Your decision</h3>
            <p className={`review-decision-state ${lead.permission}`}>
              {lead.suppressed
                ? "On the do-not-contact list"
                : decisionLabels[lead.permission]}
            </p>
            <div className="review-quick" aria-label="Reasons to use">
              {suggestion && (
                <button
                  type="button"
                  className="review-suggest"
                  onClick={() => setReason(suggestion)}
                >
                  Use the checks as my reason <kbd>U</kbd>
                </button>
              )}
              {rejectionReasons(agency).map((r) => (
                <button
                  type="button"
                  key={r}
                  className="review-reason"
                  onClick={() => setReason(r)}
                >
                  {r.replace(/\.$/, "")}
                </button>
              ))}
            </div>
            <label className="field-label">
              Why is this OK or not OK to contact?
              <textarea
                rows={4}
                maxLength={2000}
                placeholder="Example: Public business contact page. Country confirmed from the store's address."
                value={rationale}
                onChange={(e) =>
                  setDrafts({ ...drafts, [lead.id]: e.target.value })
                }
              />
            </label>
            <small className="review-count">
              {reasonLength} / {minRationale} characters minimum
            </small>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <div className="review-actions">
              <Button disabled={!canApprove} onClick={approve}>
                {busy === "approved" ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <ShieldCheck size={15} />
                )}
                Approve <kbd>A</kbd>
              </Button>
              <Button variant="outline" disabled={!canReject} onClick={reject}>
                {busy === "rejected" && (
                  <LoaderCircle size={15} className="spin" />
                )}
                Not eligible <kbd>N</kbd>
              </Button>
            </div>
            <p className="review-needs" role="status">
              {needs.length
                ? `To approve: ${needs.join(", ")}.`
                : "Ready to approve. Approval lasts 30 days."}
            </p>
          </section>
        </div>
        <footer className="review-footer">
          <span>
            Scout never sends messages.
            {queue.length > 1 && (
              <span className="review-keys">
                {" "}
                <kbd>S</kbd> skip · <kbd>←</kbd> <kbd>→</kbd> move
              </span>
            )}
          </span>
          {!lead.suppressed && !confirmSuppress && (
            <button
              className="text-button"
              onClick={() => setConfirmSuppress(true)}
            >
              Never contact this store
            </button>
          )}
        </footer>
        {confirmSuppress && (
          <div className="review-suppress" role="group" aria-label="Confirm">
            <p>
              Add {lead.domain} to the do-not-contact list? This blocks future
              audits and approvals.
              {reasonLength < minSuppressReason &&
                " Write a short reason above first."}
            </p>
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmSuppress(false)}
              >
                Keep it
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={!!busy || reasonLength < minSuppressReason}
                onClick={() =>
                  void decide("suppress", () => onSuppress(lead, rationale))
                }
              >
                {busy === "suppress" && (
                  <LoaderCircle size={14} className="spin" />
                )}
                Never contact
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
