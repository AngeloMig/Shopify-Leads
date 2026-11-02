import { useEffect, useState } from "react";
import { api } from "../lib";
import {
  onlineWorkers,
  philippineTime,
  type OperationsSnapshot,
} from "../../shared/automation";
import { Button } from "./ui/button";
export function OperationsStatus({ live }: { live: boolean }) {
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
  }, [live, revision]);
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
                      ? "Worker running a job"
                      : "Worker ready"}
          </strong>
          <small>
            {error ||
              (!data
                ? "Loading status and usage."
                : !online.length
                  ? "Start it on your Mac. Queued jobs will wait."
                  : "The background process that runs your jobs.")}
          </small>
        </div>
        <div>
          <strong>
            Discovery {data?.usage.discovery_units ?? 0} /{" "}
            {data?.budgets.discovery_daily_budget ?? "shared limit"}
          </strong>
          <small>requests used today</small>
        </div>
        <div>
          <strong>
            Audits {data?.usage.audit_units ?? 0} /{" "}
            {data?.budgets.audit_daily_budget ?? "shared limit"}
          </strong>
          <small>
            {data?.usage.units ?? 0} / {data?.budgets.daily_api_budget ?? "—"}{" "}
            total today
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
    </>
  );
}
