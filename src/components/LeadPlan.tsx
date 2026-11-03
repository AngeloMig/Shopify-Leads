import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ClipboardList,
  Copy,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import {
  callText,
  hasFullEvidence,
  leadPlaybook,
  planText,
} from "../../shared/lead-playbook";
import type { Lead } from "../../shared/types";
import { Button } from "./ui/button";

const severityLabels = { high: "Do first", medium: "Next", low: "Later" };
function CopyButton({
  label,
  text,
  disabled = false,
}: {
  label: string;
  text: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2200);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      onClick={() =>
        void navigator.clipboard
          .writeText(text)
          .then(() => setState("copied"))
          .catch(() => setState("failed"))
      }
    >
      {state === "copied" ? <Check size={14} /> : <Copy size={14} />}
      {state === "copied"
        ? "Copied"
        : state === "failed"
          ? "Couldn't copy"
          : label}
    </Button>
  );
}
/** A starting point for a person to edit. Scout never sends any of it. */
export function LeadPlan({
  lead,
  onOpenReview,
  evidenceError,
  onRetryEvidence,
}: {
  lead: Lead;
  onOpenReview: (lead: Lead) => void;
  evidenceError?: string;
  onRetryEvidence?: () => void;
}) {
  const ready = hasFullEvidence(lead);
  const plan = useMemo(
    () => leadPlaybook(ready ? lead : { ...lead, findings: [] }),
    [lead, ready],
  );
  const [channel, setChannel] = useState<"email" | "call">("email");
  const [subject, setSubject] = useState(plan.email?.subject ?? "");
  const [body, setBody] = useState(plan.email?.body ?? "");
  const [call, setCall] = useState(callText(plan));
  useEffect(() => {
    setSubject(plan.email?.subject ?? "");
    setBody(plan.email?.body ?? "");
    setCall(callText(plan));
  }, [lead.id, plan.email?.body]);
  const approved = lead.permission === "approved" && !lead.suppressed;
  if (!ready)
    return (
      <div
        className="lead-plan-pending"
        role="tabpanel"
        id="lead-panel-plan"
        aria-labelledby="lead-tab-plan"
      >
        {evidenceError ? (
          <>
            <p role="alert">
              Couldn't load this store's evidence, so there's no plan yet.
            </p>
            {onRetryEvidence && (
              <Button size="sm" variant="outline" onClick={onRetryEvidence}>
                Try again
              </Button>
            )}
          </>
        ) : (
          <p role="status">
            <LoaderCircle size={15} className="spin" aria-hidden="true" />
            Loading this store's evidence…
          </p>
        )}
      </div>
    );
  return (
    <div
      className="lead-plan"
      role="tabpanel"
      id="lead-panel-plan"
      aria-labelledby="lead-tab-plan"
    >
      <section aria-labelledby="lead-plan-needs">
        <header>
          <h3 id="lead-plan-needs">What this store needs</h3>
          {plan.needs.length > 0 && (
            <CopyButton label="Copy plan" text={planText(lead, plan)} />
          )}
        </header>
        {plan.needs.length ? (
          <ol className="plan-needs">
            {plan.needs.map((need) => (
              <li key={need.service}>
                <div>
                  <h4>{need.service}</h4>
                  <span className={`plan-priority ${need.severity}`}>
                    {severityLabels[need.severity]}
                  </span>
                </div>
                <p>{need.why}</p>
                <ul>
                  {need.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
                <details>
                  <summary>Work to do</summary>
                  <ul className="plan-steps">
                    {need.steps.map((step) => (
                      <li key={step}>
                        <ClipboardList size={13} aria-hidden="true" />
                        {step}
                      </li>
                    ))}
                  </ul>
                  <p>
                    <strong>How to check it worked:</strong> {need.check}
                  </p>
                </details>
              </li>
            ))}
          </ol>
        ) : (
          <p className="plan-empty">
            No verified findings yet, so there's nothing to recommend. Re-audit
            the store or review its evidence first.
          </p>
        )}
        {plan.toConfirm.length > 0 && (
          <div className="plan-confirm">
            <h4>Not verified: ask, don't claim</h4>
            <ul>
              {plan.toConfirm.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="plan-confirm">
          <h4>Questions to ask the client</h4>
          <ul>
            {plan.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      </section>
      <section aria-labelledby="lead-plan-script">
        <header>
          <h3 id="lead-plan-script">Your script</h3>
          {plan.email && !lead.suppressed && (
            <div className="plan-channel" role="group" aria-label="Script type">
              {(["email", "call"] as const).map((id) => (
                <button
                  key={id}
                  aria-pressed={channel === id}
                  onClick={() => setChannel(id)}
                >
                  {id === "email" ? "Email" : "Call"}
                </button>
              ))}
            </div>
          )}
        </header>
        {lead.suppressed ? (
          <p className="plan-empty">
            This store is on the do-not-contact list, so there's no script.
          </p>
        ) : !plan.email ? (
          <p className="plan-empty">
            A script appears once there's a verified finding to talk about.
          </p>
        ) : (
          <>
            {!approved && (
              <div className="plan-gate" role="status">
                <ShieldCheck size={15} aria-hidden="true" />
                <span>Draft only until this store passes outreach review.</span>
                <button
                  className="text-button"
                  onClick={() => onOpenReview(lead)}
                >
                  Review now
                </button>
              </div>
            )}
            <p className="plan-to">
              {plan.contact ? `Contact: ${plan.contact}` : "No contact found."}
            </p>
            {channel === "email" && (
              <label className="field-label">
                Subject
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </label>
            )}
            <label className="field-label">
              {channel === "email" ? "Message" : "Talking points"}
              <textarea
                rows={channel === "email" ? 15 : 13}
                value={channel === "email" ? body : call}
                onChange={(e) =>
                  channel === "email"
                    ? setBody(e.target.value)
                    : setCall(e.target.value)
                }
              />
            </label>
            <footer>
              <small>
                Replace the [brackets] and edit it to sound like you. Scout
                doesn't send this.
              </small>
              <CopyButton
                label={channel === "email" ? "Copy email" : "Copy call script"}
                text={
                  channel === "email" ? `Subject: ${subject}\n\n${body}` : call
                }
                disabled={!approved}
              />
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
