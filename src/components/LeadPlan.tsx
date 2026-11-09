import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ClipboardList,
  Copy,
  LoaderCircle,
  Mail,
  ShieldCheck,
} from "lucide-react";
import {
  callText,
  hasFullEvidence,
  leadPlaybook,
  planText,
} from "../../shared/lead-playbook";
import type { Lead } from "../../shared/types";
import { Link } from "react-router-dom";
import { api, formatDate } from "../lib";
import { emptySender } from "../../shared/sender";
import {
  emailSequence,
  emailStepLabel,
  nextEmailStep,
  type ContactPerson,
  type EmailStep,
} from "../../shared/contact-log";
import { useSender } from "../sender-store";
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
  demo = false,
  onLeave,
  onRetest,
  onOpenReview,
  onEmailed,
  onSavePerson,
  busy = false,
  evidenceError,
  onRetryEvidence,
}: {
  lead: Lead;
  demo?: boolean;
  /** Close whatever the plan is shown in, before going to Settings. */
  onLeave?: () => void;
  /** Run the audit again, so the numbers quoted are current. */
  onRetest?: () => void;
  onOpenReview: (lead: Lead) => void;
  /** Log "Emailed" with the next reminder, after opening the email app. */
  onEmailed?: () => void;
  onSavePerson?: (person: ContactPerson | null) => Promise<void>;
  busy?: boolean;
  evidenceError?: string;
  onRetryEvidence?: () => void;
}) {
  const ready = hasFullEvidence(lead);
  const sender = useSender(demo);
  const plan = useMemo(
    () =>
      leadPlaybook(
        {
          ...(ready ? lead : { ...lead, findings: [] }),
          contact_name: lead.contact_person?.name ?? null,
        },
        sender ?? emptySender,
      ),
    [lead, ready, sender],
  );
  const missing = sender
    ? [
        !sender.name && "your name",
        !sender.company && "company",
        !sender.portfolio_url && "portfolio link",
        !sender.email && "email",
      ].filter((m): m is string => !!m)
    : [];
  const [channel, setChannel] = useState<"email" | "call">("email");
  // Which email in the sequence, from how many you've already sent.
  const sent = lead.contact?.emails ?? 0;
  const suggested = nextEmailStep(sent);
  const [step, setStep] = useState<EmailStep>(suggested ?? "final");
  const draft = plan.emails?.[step] ?? plan.email;
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [person, setPerson] = useState<ContactPerson>(
    lead.contact_person ?? { name: "", role: "" },
  );
  useEffect(
    () => setPerson(lead.contact_person ?? { name: "", role: "" }),
    [lead.id, lead.contact_person?.name, lead.contact_person?.role],
  );
  useEffect(() => setStep(nextEmailStep(sent) ?? "final"), [lead.id, sent]);
  const email = plan.contact?.includes("@") ? plan.contact : null;
  const mailto = email
    ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;
  const [call, setCall] = useState(callText(plan));
  const [linking, setLinking] = useState<"idle" | "busy" | "failed">("idle");
  const age = lead.audited_at
    ? Math.floor((Date.now() - Date.parse(lead.audited_at)) / 86400000)
    : null;
  // PageSpeed moves between runs; quote numbers they can see for themselves.
  const stale = age !== null && age > 14;
  async function addReportLink() {
    if (!lead.report_id) return;
    setLinking("busy");
    try {
      const { url, expires_at } = await api<{
        url: string;
        expires_at: string;
      }>(`/reports/${lead.report_id}/share`, {});
      const line = `Here's the short report with everything we found (the link works until ${formatDate(expires_at, true)}): ${url}`;
      setBody((b) =>
        b.includes("Would it be useful if I sent over the short report?")
          ? b.replace(
              "Would it be useful if I sent over the short report?",
              `${line}\n\nHappy to talk it through if it's useful.`,
            )
          : `${b}\n\n${line}`,
      );
      setLinking("idle");
    } catch {
      setLinking("failed");
    }
  }
  useEffect(() => {
    setSubject(draft?.subject ?? "");
    setBody(draft?.body ?? "");
    setCall(callText(plan));
  }, [lead.id, draft?.body]);
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
            {stale && (
              <div className="plan-gate plan-stale" role="status">
                <span>
                  Audited {age} days ago. Re-test before you send, so the
                  numbers match what they'll see.
                </span>
                {onRetest && (
                  <button className="text-button" onClick={onRetest}>
                    Re-test now
                  </button>
                )}
              </div>
            )}
            <p className="plan-to">
              {plan.contact ? `Contact: ${plan.contact}` : "No contact found."}
            </p>
            {onSavePerson && (
              <form
                className="plan-person"
                onSubmit={(e) => {
                  e.preventDefault();
                  void onSavePerson(
                    person.name.trim()
                      ? { name: person.name.trim(), role: person.role.trim() }
                      : null,
                  );
                }}
              >
                <label className="field-label">
                  Contact person
                  <input
                    value={person.name}
                    placeholder="From their About or Team page"
                    onChange={(e) =>
                      setPerson((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </label>
                <label className="field-label">
                  Role
                  <input
                    value={person.role}
                    placeholder="Founder, owner…"
                    onChange={(e) =>
                      setPerson((p) => ({ ...p, role: e.target.value }))
                    }
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  type="submit"
                  disabled={
                    busy ||
                    (person.name.trim() === (lead.contact_person?.name ?? "") &&
                      person.role.trim() === (lead.contact_person?.role ?? ""))
                  }
                >
                  Save
                </Button>
              </form>
            )}
            {channel === "email" && (
              <div
                className="plan-channel plan-steps-pick"
                role="group"
                aria-label="Which email"
              >
                {emailSequence.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={step === id}
                    onClick={() => setStep(id)}
                  >
                    {emailStepLabel[id]}
                    {id === suggested && sent > 0 ? " · next" : ""}
                  </button>
                ))}
              </div>
            )}
            {channel === "email" && sent > 0 && (
              <p className="plan-to" role="status">
                {suggested
                  ? `${sent} ${sent === 1 ? "email" : "emails"} sent. Send the ${emailStepLabel[suggested].toLowerCase()} as a reply to your first email, so it stays in one thread.`
                  : "All three emails sent. If there's no reply, mark this lead lost with “No response” and stop here."}
              </p>
            )}
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
                {missing.length ? (
                  <>
                    <Link to="/settings#your-details" onClick={onLeave}>
                      Add {missing.join(", ").replace(/, ([^,]*)$/, " and $1")}
                    </Link>{" "}
                    in Settings to fill these in, or replace the
                    [brackets].{" "}
                  </>
                ) : (
                  "Edit it to sound like you. "
                )}
                Scout doesn't send this.
                {mailto && channel === "email"
                  ? " Open in email app logs it as emailed and sets the next reminder."
                  : ""}
              </small>
              {channel === "email" && lead.report_id && !demo && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    linking === "busy" || body.includes("/audit-artifacts/")
                  }
                  onClick={() => void addReportLink()}
                >
                  {linking === "busy" && (
                    <LoaderCircle size={14} className="spin" />
                  )}
                  {body.includes("/audit-artifacts/")
                    ? "Report link added"
                    : linking === "failed"
                      ? "Couldn't make a link. Try again"
                      : "Add report link"}
                </Button>
              )}
              {channel === "email" && mailto && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!approved || busy}
                  onClick={() => {
                    window.location.href = mailto;
                    onEmailed?.();
                  }}
                >
                  <Mail size={14} />
                  Open in email app
                </Button>
              )}
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
