import { useState } from "react";
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
  minRationale,
  minSuppressReason,
  nextInQueue,
  reviewChecks,
  type ReviewCheck,
} from "../../shared/outreach-review";
import { countryNames, type Lead } from "../../shared/types";
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
function CheckRow({ check }: { check: ReviewCheck }) {
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
      </div>
    </li>
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
  const position = queue.indexOf(currentId);
  const move = (step: number) => {
    setError("");
    setConfirmSuppress(false);
    setCurrentId(queue[(position + step + queue.length) % queue.length]);
  };
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
  const score = leadScoreFor(lead).researchScore;
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
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={lead.name}
      description={`${lead.domain} · ${demo ? "Fictional sample prospect" : "Outreach review"}`}
      className="review-dialog"
    >
      <div
        onKeyDown={(e) => {
          if (
            queue.length > 1 &&
            (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
            !(e.target as HTMLElement).matches("textarea,input,select")
          )
            move(e.key === "ArrowLeft" ? -1 : 1);
        }}
      >
        <div className="review-bar">
          <span>
            {[
              lead.country && countryNames[lead.country],
              lead.industry,
              `Score ${score}`,
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
                <CheckRow check={check} key={check.id} />
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
              <Button
                disabled={!!busy || needs.length > 0}
                onClick={() =>
                  void decide("approved", () =>
                    onReview(lead, "approved", rationale),
                  )
                }
              >
                {busy === "approved" ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <ShieldCheck size={15} />
                )}
                Approve
              </Button>
              <Button
                variant="outline"
                disabled={!!busy || reasonLength < minRationale}
                onClick={() =>
                  void decide("rejected", () =>
                    onReview(lead, "rejected", rationale),
                  )
                }
              >
                {busy === "rejected" && (
                  <LoaderCircle size={15} className="spin" />
                )}
                Not eligible
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
          <span>Scout never sends messages.</span>
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
