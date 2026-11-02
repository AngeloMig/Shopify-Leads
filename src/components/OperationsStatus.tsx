import { useEffect, useState } from "react";
import { api } from "../lib";
import {
  onlineWorkers,
  philippineTime,
  type OperationsSnapshot,
} from "../../shared/automation";
import { Button } from "./ui/button";
export function OperationsStatus({
  live,
  detailed = false,
  onChange,
}: {
  live: boolean;
  detailed?: boolean;
  onChange?: (data: OperationsSnapshot) => void;
}) {
  const [data, setData] = useState<OperationsSnapshot | null>(null),
    [error, setError] = useState(""),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!live) return;
    let active = true;
    const load = () =>
      void api<OperationsSnapshot>("/operations")
        .then((d) => {
          if (active) {
            setData(d);
            onChange?.(d);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [live, onChange, revision]);
  if (!live) return null;
  const online = onlineWorkers(data);
  const working = online.some((w) => w.state === "working"),
    paused = online.length > 0 && online.every((w) => w.state === "paused");
  return (
    <>
      <section
        className="operations-strip"
        aria-label="Worker health and daily API usage"
      >
        <div>
          <span
            className={`health-dot ${online.length && !paused ? "online" : ""}`}
          />
          <strong>
            {error
              ? "Worker status unavailable"
              : !data
                ? "Checking worker…"
                : !online.length
                  ? "Worker offline"
                  : paused
                    ? "Worker paused"
                    : working
                      ? "Worker processing jobs"
                      : "Worker online"}
          </strong>
          <small>
            {error ||
              (!data
                ? "Loading the latest heartbeat and request usage."
                : !online.length
                  ? "Start Scout’s worker on your Mac. Queued work is retained."
                  : `${online.length} worker${online.length === 1 ? "" : "s"} connected · heartbeat within 90 seconds`)}
          </small>
        </div>
        <div>
          <strong>
            Discovery {data?.usage.discovery_units ?? 0} /{" "}
            {data?.budgets.discovery_daily_budget ?? "shared cap"}
          </strong>
          <small>requests today (UTC)</small>
        </div>
        <div>
          <strong>
            Audits {data?.usage.audit_units ?? 0} /{" "}
            {data?.budgets.audit_daily_budget ?? "shared cap"}
          </strong>
          <small>
            {data?.usage.units ?? 0} /{" "}
            {data?.budgets.daily_api_budget ?? "shared cap"} total requests
            today (UTC)
          </small>
        </div>
      </section>
      {actionError && (
        <p className="error-banner" role="alert">
          {actionError}
        </p>
      )}
      {data?.blocks
        .filter(
          (b) =>
            !b.blocked_until ||
            Date.parse(b.blocked_until) > Date.parse(data.server_time),
        )
        .map((block) => (
          <section
            className="automation-notice"
            key={block.provider}
            role="status"
          >
            <div>
              <strong>{block.provider} requests paused</strong>
              <p>{block.reason}</p>
              <small>
                {block.blocked_until
                  ? `Eligible ${philippineTime(block.blocked_until)}`
                  : "Update the server credentials or provider account, then resume."}
              </small>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              aria-label={`Resume ${block.provider} requests`}
              onClick={async () => {
                setBusy(block.provider);
                setActionError("");
                try {
                  await api(
                    `/operations/providers/${block.provider}/resume`,
                    {},
                    "POST",
                  );
                  setRevision((x) => x + 1);
                } catch (e) {
                  setActionError((e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === block.provider ? "Resuming…" : "Resume provider"}
            </Button>
          </section>
        ))}
      {detailed && data?.summary && (
        <section
          className="panel automation-summary"
          aria-label="Automation results summary"
        >
          <div className="automation-summary-heading">
            <div>
              <h2>Results for this request day</h2>
              <p>
                Since {philippineTime(data.summary.since)} · resets at 8:00 AM
                PHT
              </p>
            </div>
            <span>
              {data.summary.audit_backlog} audits in queue ·{" "}
              {data.summary.needs_attention} need attention
            </span>
          </div>
          <dl className="automation-summary-grid">
            {[
              ["New stores tracked", data.summary.stores_found],
              ["Published audits", data.summary.audits_completed],
              ["New leads", data.summary.new_leads],
              ["New leads with email", data.summary.leads_with_email],
              ["Previously researched", data.summary.previously_researched],
              [
                "Duplicate results",
                data.summary.duplicate_tracking_searches
                  ? data.summary.duplicate_results
                  : "Not recorded",
              ],
              ["Failed jobs", data.summary.failures],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="automation-summary-note">
            Store and duplicate tracking starts with this update; older missing
            counts stay unrecorded. Contacts are public-source evidence, not
            mailbox validation.
          </p>
          <details className="automation-schedules">
            <summary>Schedules & queue controls</summary>
            <p>
              New discovery runs wait at {data.budgets.max_audit_backlog ?? 5}{" "}
              queued/running audits; active runs may finish their batch. Each
              campaign can schedule up to{" "}
              {data.budgets.scheduled_runs_per_day ?? 1} run(s) per UTC day.
              Audits take priority.
            </p>
            {data.schedules.map((schedule) => (
              <div key={schedule.id}>
                <strong>{schedule.name}</strong>
                <span>
                  {!schedule.enabled
                    ? "Schedule off"
                    : Date.parse(schedule.next_run_at) <=
                        Date.parse(data.server_time)
                      ? "Due · runs when worker and queue allow"
                      : `Next eligible ${philippineTime(schedule.next_run_at)}`}
                </span>
              </div>
            ))}
          </details>
        </section>
      )}
    </>
  );
}
