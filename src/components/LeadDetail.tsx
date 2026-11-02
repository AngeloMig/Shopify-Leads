import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  FileText,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Globe2,
  Clock3,
  Image,
  NotebookPen,
  Mail,
  LoaderCircle,
  ShieldX,
} from "lucide-react";
import type { Lead, PsiSample, PublicEmail } from "../../shared/types";
import { comparableRuns, reportIssues } from "../../shared/audit-presentation";
import { explainFinding } from "../../shared/finding-explanation";
import {
  leadIntelligence,
  contactCategory,
  mailStatus,
  type MailChecks,
} from "../../shared/lead-intelligence";
import { countryNames, industries, lostReasons } from "../../shared/types";
import { leadScoreFor } from "../../shared/lead-score";
import { api, formatDate } from "../lib";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Priority, flags } from "./LeadTable";
import { PageSpeedAudit, type ScoreDevice } from "./PageSpeedAudit";
function PublicContactRow({
  contact,
  mail,
  preferred,
  busy,
  onPrefer,
}: {
  contact: PublicEmail;
  mail?: MailChecks;
  preferred: boolean;
  busy: boolean;
  onPrefer: (email: string) => void;
}) {
  const category = contactCategory(contact.email);
  const status = mailStatus(contact.email, mail);
  return (
    <div className="detail-contact">
      <div className="contact-address">
        <a href={`mailto:${contact.email}`}>{contact.email}</a>
        <span className="contact-role">
          {category === "Unknown" ? "Public email" : category}
          {contact.observed_at
            ? ` · Found ${formatDate(contact.observed_at)}`
            : ""}
          {status === "ok" && (
            <span title="This domain has a mail server. The mailbox itself isn't confirmed.">
              {" "}
              · Domain takes mail
            </span>
          )}
          {status === "none" && (
            <span className="contact-mail-none">
              {" "}
              · Domain takes no mail
            </span>
          )}
        </span>
      </div>
      <div className="contact-controls">
        <a
          className="contact-source"
          href={contact.source_url}
          target="_blank"
          rel="noreferrer"
        >
          Source page <ExternalLink size={12} />
        </a>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || preferred}
          onClick={() => onPrefer(contact.email)}
        >
          {preferred ? "Preferred contact" : "Use as preferred"}
        </Button>
      </div>
    </div>
  );
}
export function LeadDetail({
  lead,
  onClose,
  onReport,
  onAudit,
  onUpdate,
  onReview,
  onSuppress,
  demo,
}: {
  lead: Lead | null;
  onClose: () => void;
  onReport: (l: Lead) => void;
  onAudit: (l: Lead) => void;
  onUpdate: (l: Lead, patch: Partial<Lead>) => Promise<void>;
  onReview: (
    l: Lead,
    status: "approved" | "rejected",
    rationale: string,
  ) => Promise<void>;
  onSuppress: (l: Lead, reason: string) => Promise<void>;
  demo: boolean;
}) {
  const [tab, setTab] = useState("findings"),
    [notes, setNotes] = useState(""),
    [owner, setOwner] = useState(""),
    [businessName, setBusinessName] = useState(""),
    [industry, setIndustry] = useState("Unknown"),
    [rationale, setRationale] = useState(""),
    [lostReason, setLostReason] =
      useState<(typeof lostReasons)[number]>("No response"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<Record<string, unknown>[]>([]),
    [artifacts, setArtifacts] = useState<{
      screenshots: { url: string; page_url: string }[];
      history: Record<string, unknown>[];
      metrics: PsiSample[];
    } | null>(null),
    [historyError, setHistoryError] = useState("");
  useEffect(() => {
    setTab("findings");
    setNotes(lead?.notes ?? "");
    setOwner(lead?.owner ?? "");
    setBusinessName(lead?.name ?? "");
    setIndustry(lead?.industry ?? "Unknown");
    setRationale("");
    setError("");
    setArtifacts(null);
    setHistory([]);
    setHistoryError("");
    if (lead && !demo) {
      let active = true;
      void Promise.all([
        api<Record<string, unknown>[]>(`/leads/${lead.id}/history`),
        api<NonNullable<typeof artifacts>>(`/leads/${lead.id}/artifacts`),
      ])
        .then(([h, a]) => {
          if (active) {
            setHistory(h);
            setArtifacts(a);
          }
        })
        .catch((e) => {
          if (active) setHistoryError(e.message);
        });
      return () => {
        active = false;
      };
    }
  }, [lead?.id, lead?.audited_at, demo]);
  async function action(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  const issues = useMemo(
    () => reportIssues(lead?.findings ?? [], artifacts?.metrics ?? []),
    [lead?.findings, artifacts?.metrics],
  );
  if (!lead) return null;
  const intelligence = leadIntelligence(lead);
  const score = leadScoreFor(lead);
  const scoreDevice = (strategy: "mobile" | "desktop"): ScoreDevice => {
    const group = comparableRuns(artifacts?.metrics ?? [], strategy);
    return {
      scores: Object.fromEntries(
        ["performance", "accessibility", "best-practices", "seo"].map((key) => [
          key,
          group.score(key),
        ]),
      ),
      note: demo
        ? "No real measurements in demo mode."
        : group.comparable
          ? "Median of 3 comparable saved tests · out of 100"
          : "Three comparable saved tests are required for median scores.",
      testedAt: group.runs.at(-1)?.tested_at,
      url: group.comparable ? group.runs[0]?.url : undefined,
    };
  };
  return (
    <Dialog
      open={!!lead}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={lead.name}
      description={`${lead.domain} · ${demo ? "Fictional sample prospect" : "Public storefront research"}`}
      wide
      className="lead-dialog"
    >
      <div className="lead-detail">
        <div className="detail-top">
          <div className="detail-business">
            <span className={`brand-avatar large ${lead.color ?? "sage"}`}>
              {lead.name.slice(0, 1)}
            </span>
            <div>
              <span className="detail-tags">
                {lead.country && (
                  <span>
                    {flags[lead.country]} {countryNames[lead.country]}
                  </span>
                )}
                <span>{lead.industry}</span>
              </span>
              <span className="verified-label">
                <ShieldCheck size={14} />
                {demo
                  ? "Sample Shopify verification"
                  : "Shopify evidence verified"}{" "}
                · {formatDate(lead.audited_at)}
              </span>
            </div>
          </div>
          <span
            className={`strength strength-${intelligence.rank}`}
            title={intelligence.reason}
          >
            {intelligence.label} opportunity
          </span>
        </div>
        {demo && (
          <div className="sample-note">
            Synthetic sample · These findings illustrate the interface. No real
            business was audited.
          </div>
        )}
        <section className="lead-brief" aria-label="Lead research summary">
          <dl>
            <div>
              <dt>Why this store?</dt>
              <dd>
                <strong>{intelligence.main}</strong>
                <p>{intelligence.reason}</p>
              </dd>
            </div>
            <div>
              <dt>What could we offer?</dt>
              <dd>{intelligence.service}</dd>
            </div>
            <div>
              <dt>What happens next?</dt>
              <dd>
                <span className="review-state">{intelligence.review}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (intelligence.stale) onAudit(lead);
                    else
                      setTab(
                        intelligence.next === "Review findings"
                          ? "findings"
                          : "review",
                      );
                  }}
                  disabled={lead.suppressed || busy}
                >
                  {intelligence.next}
                </Button>
              </dd>
            </div>
          </dl>
          <details className="brief-scope">
            <summary>How this lead is assessed</summary>
            <p className="muted">
              Opportunity strength reflects the saved technical evidence.
              Outreach approval is reviewed separately; a public email is not
              approval.
            </p>
          </details>
        </section>
        <section className="lead-score" aria-label="Why this score">
          <div className="lead-score-head">
            <p className="lead-score-total">
              <strong>{score.researchScore}</strong>
              <span>/100</span>
            </p>
            <div>
              <h3>Why this score</h3>
              <p
                className={
                  score.eligible
                    ? "lead-score-status ready"
                    : "lead-score-status"
                }
              >
                {score.eligible
                  ? `Priority ${score.grade}`
                  : score.grade === "Hold"
                    ? `Hold · needs ${score.blockers.join(" and ")}`
                    : `Priority ${score.grade} after ${score.blockers.join(" and ")}`}
              </p>
            </div>
          </div>
          <dl className="lead-score-parts">
            {score.parts.map((part) => (
              <div key={part.key}>
                <dt>{part.label}</dt>
                <dd>{part.reason}</dd>
                <dd className="lead-score-meter" aria-hidden="true">
                  <i style={{ width: `${(part.points / part.max) * 100}%` }} />
                </dd>
                <dd className="lead-score-points">
                  {part.points}
                  <span>/{part.max}</span>
                </dd>
              </div>
            ))}
          </dl>
          {score.raise.length > 0 && (
            <div className="lead-score-raise">
              <h4>Raise this score</h4>
              <ul>
                {score.raise.map((step) => (
                  <li key={step.label}>
                    {step.label}
                    <b>up to +{step.points}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lead.catalog && (
            <p className="lead-catalog">
              <span>
                {lead.catalog.product_count}
                {lead.catalog.count_capped ? "+" : ""} products
              </span>
              {lead.catalog.median_price !== null && (
                <span>Typical price {lead.catalog.median_price}</span>
              )}
              <a
                href={lead.catalog.source_url}
                target="_blank"
                rel="noreferrer"
              >
                Public catalog <ExternalLink size={12} />
              </a>
            </p>
          )}
        </section>
        <section className="lead-outcome" aria-label="Sales outcome">
          <h3>Outcome</h3>
          <p className="muted">
            {lead.outcome === "won"
              ? "Marked as won. Search learning favors the query that found this store."
              : lead.outcome === "lost"
                ? `Marked as lost${lead.outcome_reason ? `: ${lead.outcome_reason}` : ""}.`
                : "Record what happened so search learning can favor stores that become clients."}
          </p>
          <div className="lead-outcome-actions">
            <Button
              type="button"
              variant={lead.outcome === "won" ? "default" : "outline"}
              disabled={busy || lead.outcome === "won"}
              onClick={() =>
                void action(() =>
                  onUpdate(lead, { outcome: "won", outcome_reason: null }),
                )
              }
            >
              Mark won
            </Button>
            <select
              aria-label="Reason this lead was lost"
              value={lostReason}
              disabled={busy}
              onChange={(e) =>
                setLostReason(e.target.value as typeof lostReason)
              }
            >
              {lostReasons.map((reason) => (
                <option key={reason}>{reason}</option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(() =>
                  onUpdate(lead, {
                    outcome: "lost",
                    outcome_reason: lostReason,
                  }),
                )
              }
            >
              Mark lost
            </Button>
            {lead.outcome && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    onUpdate(lead, { outcome: null, outcome_reason: null }),
                  )
                }
              >
                Clear
              </Button>
            )}
          </div>
        </section>
        <section
          className="detail-contacts"
          aria-label="Public email addresses"
        >
          <div className="detail-contact-heading">
            <h3>
              <Mail size={16} /> Public email
            </h3>
            {lead.preferred_email && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void action(() => onUpdate(lead, { preferred_email: null }))
                }
              >
                Use automatic contact ranking
              </Button>
            )}
          </div>
          {lead.emails?.length ? (
            <>
              <PublicContactRow
                contact={intelligence.emails[0]}
                mail={lead.mail_checks}
                preferred={
                  lead.preferred_email === intelligence.emails[0].email
                }
                busy={busy}
                onPrefer={(email) =>
                  void action(() => onUpdate(lead, { preferred_email: email }))
                }
              />
              {intelligence.emails.length > 1 && (
                <details className="more-public-contacts">
                  <summary>
                    {intelligence.emails.length - 1} more public{" "}
                    {intelligence.emails.length === 2 ? "contact" : "contacts"}
                  </summary>
                  {intelligence.emails.slice(1).map((contact) => (
                    <PublicContactRow
                      key={contact.email}
                      contact={contact}
                      mail={lead.mail_checks}
                      preferred={lead.preferred_email === contact.email}
                      busy={busy}
                      onPrefer={(email) =>
                        void action(() =>
                          onUpdate(lead, { preferred_email: email }),
                        )
                      }
                    />
                  ))}
                </details>
              )}
            </>
          ) : (
            <p>
              No public email found in the pages checked. Review the contact
              page in Outreach review.
            </p>
          )}
          {!!lead.emails?.length && (
            <p>
              Published on the store’s website. Domains are checked for a mail
              server, but individual mailboxes aren’t confirmed.
            </p>
          )}
        </section>
        <PageSpeedAudit
          key={lead.id}
          mobile={scoreDevice("mobile")}
          desktop={scoreDevice("desktop")}
          pending={!demo && !artifacts && !historyError}
        />
        <div className="detail-actions">
          <Button
            size="sm"
            onClick={() => onReport(lead)}
            disabled={!lead.report_id}
          >
            <FileText size={15} />
            Download report
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAudit(lead)}>
            <RefreshCw size={14} />
            Re-audit store
          </Button>
          <a
            className="button button-ghost button-sm"
            href={`https://${lead.domain}`}
            target="_blank"
            rel="noreferrer"
          >
            Visit storefront <ExternalLink size={13} />
          </a>
        </div>
        <div className="detail-tabs" role="tablist">
          {[
            ["findings", "Audit evidence"],
            ["history", "History & assets"],
            ["notes", "Profile & notes"],
            ["review", "Outreach review"],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              id={`lead-tab-${id}`}
              aria-controls={`lead-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onKeyDown={(e) => {
                const keys = ["findings", "history", "notes", "review"];
                const index = keys.indexOf(id);
                const next =
                  e.key === "ArrowRight"
                    ? (index + 1) % 4
                    : e.key === "ArrowLeft"
                      ? (index + 3) % 4
                      : e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? 3
                          : -1;
                if (next >= 0) {
                  e.preventDefault();
                  setTab(keys[next]);
                  const buttons =
                    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      "[role=tab]",
                    );
                  buttons?.[next]?.focus();
                }
              }}
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "findings" && (
          <div
            className="findings-list"
            role="tabpanel"
            id="lead-panel-findings"
            aria-labelledby="lead-tab-findings"
          >
            <div className="finding-intro">
              <h3>
                Website improvements{" "}
                <span className="count-badge">{issues.length}</span>
              </h3>
              <p>
                What we found, what it means, and how to fix it. Repeated
                observations are grouped; technical evidence is available below
                each improvement.
              </p>
            </div>
            {lead.findings.length ? (
              issues.map((f) => {
                const explanation = explainFinding(
                  f,
                  lead.findings,
                  artifacts?.metrics ?? [],
                );
                return (
                  <article className="finding client-finding" key={f.reference}>
                    <div
                      className={`finding-icon ${f.severity === "high" ? "red" : ""}`}
                    >
                      {f.kind === "verified" ? (
                        <CheckCircle2 size={18} />
                      ) : (
                        <AlertTriangle size={18} />
                      )}
                    </div>
                    <div>
                      <div className="finding-meta">
                        <span>{f.category}</span>
                        <span className={`severity ${f.severity}`}>
                          {f.severity} priority
                        </span>
                        <span>
                          {f.kind === "verified"
                            ? "Verified observation"
                            : f.kind === "hypothesis"
                              ? "Needs verification"
                              : "Optional idea"}
                        </span>
                      </div>
                      <h4>{explanation.title}</h4>
                      <p className="finding-meaning">{explanation.meaning}</p>
                      {explanation.examples.length > 0 && (
                        <div className="finding-examples">
                          <strong>Examples found on the page</strong>
                          <ul>
                            {explanation.examples.map((example, index) => (
                              <li key={index}>
                                <span>{example.text}</span>
                                <small>
                                  {example.device}
                                  {f.urls.length > 1
                                    ? ` · ${example.page}`
                                    : ""}
                                  {example.measurement
                                    ? ` · ${example.measurement}`
                                    : ""}
                                </small>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="recommendation">
                        <strong>Recommended fix</strong>
                        <p>{explanation.action}</p>
                      </div>
                      <p className="finding-validation">
                        <strong>How to check the fix</strong>
                        {explanation.validation}
                      </p>
                      <div className="finding-pages">
                        <strong>
                          Affected {f.urls.length === 1 ? "page" : "pages"}
                        </strong>
                        {f.urls.map((url) => (
                          <a
                            href={url}
                            key={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {url}
                            <ExternalLink size={11} />
                          </a>
                        ))}
                      </div>
                      <details className="finding-technical">
                        <summary>
                          Technical evidence · {f.ids.length} saved{" "}
                          {f.ids.length === 1 ? "observation" : "observations"}
                        </summary>
                        <p>
                          Confidence: {f.confidence}. These automated
                          observations apply to the recorded pages and test
                          conditions.
                        </p>
                        {f.evidence.map((text, index) => (
                          <p key={index}>{text}</p>
                        ))}
                        {lead.findings
                          .filter((finding) => f.ids.includes(finding.id))
                          .map((finding) => (
                            <details className="finding-raw" key={finding.id}>
                              <summary>
                                Original diagnostic · {finding.id}
                              </summary>
                              <p>
                                {finding.title} · {finding.url}
                              </p>
                              <pre>{finding.evidence}</pre>
                            </details>
                          ))}
                      </details>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="empty-state">
                <ShieldCheck />
                <h3>No supported findings</h3>
                <p>Run an audit to collect public evidence.</p>
              </div>
            )}
            {!!lead.recommendations?.length && (
              <>
                <h3 className="subsection-title">AI service recommendations</h3>
                {lead.recommendations.map((r, i) => (
                  <article className="finding" key={i}>
                    <div>
                      <h4>{r.service}</h4>
                      <p>{r.improvement}</p>
                      <small>
                        {r.confidence} confidence · {r.difficulty} difficulty ·{" "}
                        {r.merchant_access_required
                          ? "Merchant access required"
                          : "Public scope"}{" "}
                        · Evidence: {r.finding_ids.join(", ")}
                      </small>
                    </div>
                  </article>
                ))}
              </>
            )}
          </div>
        )}
        {tab === "history" && (
          <div
            className="detail-section"
            role="tabpanel"
            id="lead-panel-history"
            aria-labelledby="lead-tab-history"
          >
            <h3>Audit history</h3>
            {historyError && <p className="error-message">{historyError}</p>}
            {demo ? (
              <div className="history-entry">
                <span className="status-dot green" />
                <div>
                  <strong>Sample audit completed</strong>
                  <p>{formatDate(lead.audited_at)} · Synthetic example</p>
                </div>
              </div>
            ) : history.length ? (
              history.map((h) => (
                <div className="history-entry" key={String(h.id)}>
                  <span
                    className={`status-dot ${h.status === "completed" ? "green" : "gray"}`}
                  />
                  <div>
                    <strong>{String(h.status).replace("_", " ")}</strong>
                    <p>
                      {formatDate(String(h.started_at))} ·{" "}
                      {String(h.id).slice(0, 8)}
                    </p>
                    {h.error ? (
                      <p className="error-message">{String(h.error)}</p>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Audit history is loading or unavailable.</p>
            )}
            <h3>Screenshots & historical evidence</h3>
            {artifacts?.screenshots.map((s, i) => (
              <figure key={i}>
                <img
                  className="audit-screenshot"
                  src={s.url}
                  alt={`Captured mobile storefront at ${s.page_url}`}
                />
                <figcaption>{s.page_url}</figcaption>
              </figure>
            ))}
            {!artifacts?.screenshots.length && (
              <div className="asset-empty">
                <Image size={24} />
                <p>
                  No captured screenshots. Enable browser diagnostics for the
                  next audit.
                </p>
              </div>
            )}
            {artifacts?.history.map((h, i) => (
              <p key={i}>
                Historical snapshot:{" "}
                {h.snapshot_url ? (
                  <a
                    href={String(h.snapshot_url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View archive record <ExternalLink size={12} />
                  </a>
                ) : (
                  "Unavailable"
                )}
                . Visual comparison was not performed.
              </p>
            ))}
            <h3>Performance samples</h3>
            {artifacts?.metrics.length ? (
              <div className="metric-sample-list">
                {artifacts.metrics.map((m, i) => (
                  <div key={i}>
                    <strong>
                      {String(m.strategy)} · sample {String(m.sample)}
                    </strong>
                    <p>
                      Mobile/desktop test score:{" "}
                      {m.scores.performance ?? "Unavailable"}
                      {m.scores.performance !== null &&
                      m.scores.performance !== undefined
                        ? "/100"
                        : ""}{" "}
                      · Recorded {formatDate(m.tested_at)}
                    </p>
                    <p>
                      Real-user data:{" "}
                      {m.field_data.available
                        ? `available (${m.field_data.scope === "origin" ? "across this website’s origin" : "for this page"})`
                        : "not available in this response"}
                      . Lab measurements and real-user experience are different.
                    </p>
                    <details className="finding-raw">
                      <summary>Technical measurement data</summary>
                      <pre>
                        {JSON.stringify(
                          {
                            scores: m.scores,
                            field_data: m.field_data,
                            environment: m.environment,
                            tested_at: m.tested_at,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">
                {demo
                  ? "No real performance samples exist in demo mode."
                  : "No stored performance samples."}
              </p>
            )}
          </div>
        )}
        {tab === "notes" && (
          <form
            role="tabpanel"
            id="lead-panel-notes"
            aria-labelledby="lead-tab-notes"
            className="detail-section"
            onSubmit={(e) => {
              e.preventDefault();
              void action(() => onUpdate(lead, { notes, owner }));
            }}
          >
            <label className="field-label">
              Business name
              <input
                value={businessName}
                maxLength={100}
                required
                onChange={(e) => setBusinessName(e.target.value)}
              />
            </label>
            <label className="field-label">
              Industry
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              >
                {[...industries, "Unknown"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <p className="muted">
              Classification: {lead.industry_confidence ?? "unknown"}.{" "}
              {lead.industry_evidence ??
                "No supporting product evidence recorded."}
            </p>
            <details>
              <summary>Original website title</summary>
              <p>{lead.original_name ?? lead.name}</p>
            </details>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !businessName.trim()}
              onClick={() =>
                void action(() =>
                  onUpdate(lead, {
                    display_name: businessName,
                    ...(industry !== lead.industry ? { industry } : {}),
                  }),
                )
              }
            >
              Save business profile
            </Button>
            <label className="field-label">
              Lead owner
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                maxLength={100}
                placeholder="Assign a researcher"
              />
            </label>
            <label className="field-label">
              Research notes
              <textarea
                rows={7}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={10000}
                placeholder="Add context, questions, or next steps for your team..."
              />
            </label>
            <label className="field-label">
              Lead stage
              <select
                value={lead.stage}
                disabled={lead.suppressed}
                onChange={(e) =>
                  void action(() =>
                    onUpdate(lead, { stage: e.target.value as Lead["stage"] }),
                  )
                }
              >
                {[
                  "new",
                  "reviewing",
                  "qualified",
                  "hold",
                  ...(lead.suppressed ? ["suppressed"] : []),
                ].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <NotebookPen size={15} />
              )}
              Save notes
            </Button>
          </form>
        )}
        {tab === "review" && (
          <div
            className="detail-section"
            role="tabpanel"
            id="lead-panel-review"
            aria-labelledby="lead-tab-review"
          >
            <div className="inline-note">
              <ShieldCheck size={20} />
              <span>
                Human review is required. A published contact route alone does
                not authorize marketing. Approval expires after 30 days. Scout
                does not send outreach.
              </span>
            </div>
            <div className="review-facts">
              <p>
                <strong>Country evidence</strong>
                {lead.country_evidence ?? "Unknown — approval blocked"}
              </p>
              <p>
                <strong>Professional contact route</strong>
                {lead.contact_url ? (
                  <a href={lead.contact_url} target="_blank" rel="noreferrer">
                    {lead.contact_url}
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  "Unknown — approval blocked"
                )}
              </p>
              <p>
                <strong>Permission review</strong>
                <span
                  className={`badge ${lead.permission === "approved" ? "green" : ""}`}
                >
                  {lead.permission}
                </span>
              </p>
              <p>
                <strong>Suppression</strong>
                {lead.suppressed
                  ? "Suppressed — outreach blocked"
                  : "No suppression record"}
              </p>
            </div>
            <label className="field-label">
              Country-specific eligibility & review rationale
              <textarea
                required
                rows={4}
                minLength={20}
                maxLength={2000}
                placeholder="Document the applicable basis, contact relevance, and permission evidence (at least 20 characters)."
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </label>
            <div className="detail-actions">
              <Button
                disabled={
                  busy ||
                  rationale.trim().length < 20 ||
                  !lead.country_evidence ||
                  !lead.contact_url ||
                  lead.suppressed
                }
                onClick={() =>
                  void action(() => onReview(lead, "approved", rationale))
                }
              >
                <ShieldCheck size={15} />
                Approve eligibility
              </Button>
              <Button
                variant="outline"
                disabled={busy || rationale.trim().length < 20}
                onClick={() =>
                  void action(() => onReview(lead, "rejected", rationale))
                }
              >
                Reject eligibility
              </Button>
              <Button
                variant="danger"
                disabled={
                  busy || rationale.trim().length < 3 || lead.suppressed
                }
                onClick={() => void action(() => onSuppress(lead, rationale))}
              >
                <ShieldX size={15} />
                Suppress domain
              </Button>
            </div>
          </div>
        )}
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        <div className="detail-footer">
          <ShieldCheck size={14} />
          Public evidence only · Private systems and financial outcomes remain
          unknown.
        </div>
      </div>
    </Dialog>
  );
}
