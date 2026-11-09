import { useState } from "react";
import {
  ExternalLink,
  FileDown,
  FileSearch,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import type { AuditRequest, Lead } from "../../shared/types";
import { formatDate } from "../lib";
import { Button } from "./ui/button";
import "../free-audits.css";

const statusLabel: Record<AuditRequest["status"], string> = {
  queued: "Waiting to start",
  running: "Auditing",
  blocked: "Needs attention",
  completed: "Audit ready",
  failed: "Failed",
  cancelled: "Cancelled",
};
const tone = (n: number | null) =>
  n === null ? "" : n < 50 ? "bad" : n < 90 ? "fair" : "good";

/**
 * Websites someone asked to have audited: free-audit requests from the
 * tracker, and ones added with "Audit a website". Kept apart from the
 * prospects Scout finds, and never sent from here.
 */
export function FreeAuditsPage({
  requests,
  onOpenLead,
  onDownload,
  onRetry,
  onAuditWebsite,
}: {
  requests: AuditRequest[];
  onOpenLead: (lead: Lead) => void;
  onDownload: (lead: Lead) => void | Promise<void>;
  onRetry: (request: AuditRequest) => Promise<void>;
  onAuditWebsite: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const fromTracker = requests.filter((r) => r.tracker).length;
  if (!requests.length)
    return (
      <section className="panel free-audits-empty">
        <FileSearch size={26} aria-hidden="true" />
        <h2>No free audits yet</h2>
        <p>
          Requests from your website&apos;s free-audit form arrive here from the
          tracker and are audited automatically. You can also audit any
          website yourself.
        </p>
        <Button onClick={onAuditWebsite}>Audit a website</Button>
      </section>
    );
  return (
    <section className="panel free-audits" aria-label="Free audits">
      <p className="free-audits-note">
        {fromTracker > 0
          ? "Requests from the tracker are reviewed and sent there, on its Free audits page. Nothing is sent from Scout."
          : "Audits you asked for, kept apart from the prospects Scout finds. Nothing is sent from Scout."}
      </p>
      <ul>
        {requests.map((r) => {
          const lead = r.lead;
          const working = r.status === "queued" || r.status === "running";
          const stuck = r.status === "blocked" || r.status === "failed";
          return (
            <li key={r.job_id} className="free-audit">
              <div className="free-audit-main">
                <strong>
                  {lead?.name && lead.name !== r.domain
                    ? `${lead.name} · ${r.domain}`
                    : r.domain}
                </strong>
                <small>
                  {r.tracker ? "Free-audit request from the tracker" : "Added here"}{" "}
                  · {formatDate(r.requested_at, true)}
                </small>
                {stuck && r.error && (
                  <small className="free-audit-error">{r.error}</small>
                )}
              </div>
              {lead && r.status === "completed" ? (
                <div className="free-audit-scores" aria-label="Scores">
                  {(
                    [
                      ["Mobile", lead.performance],
                      ["Desktop", lead.desktop],
                      ["SEO", lead.seo],
                    ] as const
                  ).map(([label, n]) => (
                    <span key={label} className={tone(n)}>
                      <small>{label}</small>
                      {n ?? "—"}
                    </span>
                  ))}
                </div>
              ) : (
                <span className={`free-audit-status ${r.status}`}>
                  {working && <LoaderCircle size={13} className="spin" />}
                  {statusLabel[r.status]}
                </span>
              )}
              <div className="free-audit-actions">
                {lead?.report_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void onDownload(lead)}
                  >
                    <FileDown size={14} /> PDF
                  </Button>
                )}
                {lead && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onOpenLead(lead)}
                  >
                    Details
                  </Button>
                )}
                {stuck && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.job_id}
                    onClick={async () => {
                      setBusy(r.job_id);
                      try {
                        await onRetry(r);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <RotateCcw size={14} /> Try again
                  </Button>
                )}
                {r.tracker?.url && (
                  <a
                    className="free-audit-tracker"
                    href={r.tracker.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {r.status === "completed" ? "Review and send" : "Tracker"}{" "}
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
