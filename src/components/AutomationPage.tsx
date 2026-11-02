import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Compass,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Store,
  Workflow,
} from "lucide-react";
import {
  automationStatus,
  jobPresentation,
  needsAttention,
  philippineTime,
  type OperationsSnapshot,
} from "../../shared/automation";
import {
  readWork,
  stagesFor,
  stageState,
  targetFor,
  workStages,
} from "../../shared/job-activity";
import type { Job, Lead } from "../../shared/types";
import { demoOperations } from "../demo";
import { api, formatDate } from "../lib";
import { DiscoveryControls } from "./DiscoveryControls";
import { DiscoveryFunnel } from "./DiscoveryFunnel";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

const ResearchSession = lazy(() =>
  import("./ResearchSession").then((module) => ({
    default: module.ResearchSession,
  })),
);
const jobsPerPage = 10;
const filters = {
  all: { label: "All", match: () => true },
  active: {
    label: "Active",
    match: (j: Job) => j.status === "running" || j.status === "queued",
  },
  attention: {
    label: "Needs attention",
    match: (j: Job) => j.status === "blocked" || j.status === "failed",
  },
  finished: {
    label: "Finished",
    match: (j: Job) => j.status === "completed" || j.status === "cancelled",
  },
};
type Filter = keyof typeof filters;
const jobName = (job: Job) =>
  `${job.type === "discovery" ? "Discovery" : "Audit"} · ${targetFor(job).label}`;
const canResume = (job: Job) =>
  job.status === "failed" || job.status === "blocked";
const canCancel = (job: Job) =>
  ["queued", "running", "blocked"].includes(job.status);
const loadingView = (
  <section className="research-session research-loading" role="status">
    Loading the job view…
  </section>
);

function useOperations(live: boolean, revision: number) {
  const [data, setData] = useState<OperationsSnapshot | null>(null),
    [error, setError] = useState("");
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
    const timer = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [live, revision]);
  return { data: live ? data : demoOperations, error };
}
export function AutomationPage({
  jobs,
  loaded,
  leads,
  scheduled,
  demo,
  jobId,
  search,
  busy,
  jobAction,
  loading,
  navigate,
  onRefresh,
  onCancel,
  onRetry,
  onBulk,
  onStopDiscovery,
  onNewDiscovery,
  onOpenLead,
}: {
  jobs: Job[];
  /** False until the first snapshot arrives; an empty list means nothing before that. */
  loaded: boolean;
  leads: Lead[];
  scheduled: boolean;
  demo: boolean;
  jobId: string | null;
  search: string;
  busy: boolean;
  jobAction: string | null;
  loading: boolean;
  navigate: (path: string) => void;
  onRefresh: () => void;
  onCancel: (job: Job) => void;
  onRetry: (job: Job) => void;
  onBulk: (jobs: Job[], action: "cancel" | "retry") => void;
  onStopDiscovery: () => void;
  onNewDiscovery: () => void;
  onOpenLead: (lead: Lead) => void;
}) {
  const [revision, setRevision] = useState(0),
    [filter, setFilter] = useState<Filter>("all"),
    [page, setPage] = useState(0),
    [confirmCancel, setConfirmCancel] = useState(false),
    [resuming, setResuming] = useState<string | null>(null),
    [resumeError, setResumeError] = useState("");
  const { data: operations, error: statusError } = useOperations(
    !demo,
    revision,
  );
  useEffect(() => {
    const wanted = new URLSearchParams(search).get("filter");
    if (wanted && wanted in filters) {
      setFilter(wanted as Filter);
      setPage(0);
    }
  }, [search]);
  const leadFor = (job: Job) =>
    job.type === "audit"
      ? leads.find((l) => l.store_id === job.payload.store_id)
      : undefined;
  const session = (props: {
    selected: string;
    mode: "full" | "compact";
    sample?: Job["type"];
    lead?: Lead;
  }) => (
    <Suspense fallback={loadingView}>
      <ResearchSession
        jobs={jobs}
        selected={props.selected}
        mode={props.mode}
        sample={props.sample}
        onSelect={(id) => navigate(`/jobs/${id}`)}
        operations={operations}
        live={!demo}
        onCancel={onCancel}
        onRetry={onRetry}
        busy={busy}
        onAll={() => navigate("/jobs")}
        onReports={() => navigate("/reports")}
        onLead={props.lead ? () => onOpenLead(props.lead!) : undefined}
      />
    </Suspense>
  );
  if (jobId === "sample")
    return session({ selected: "", mode: "full", sample: "discovery" });
  if (jobId && !loaded) return loadingView;
  if (jobId) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job)
      return (
        <section className="panel auto-missing">
          <h2>This job isn't in your latest 100</h2>
          <p>It may have been removed, or it's too old to show here.</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/jobs")}>
            <ArrowLeft size={14} /> All jobs
          </Button>
        </section>
      );
    return session({ selected: job.id, mode: "full", lead: leadFor(job) });
  }
  const at = Date.parse(operations?.server_time ?? new Date().toISOString());
  const status = automationStatus(jobs, loaded ? operations : null);
  const running = jobs.filter((j) => j.status === "running"),
    queued = jobs.filter((j) => j.status === "queued"),
    attention = jobs.filter((j) => needsAttention(j, at)),
    resumable = attention.filter((j) => j.error_code !== "search_limit"),
    paused = (operations?.blocks ?? []).filter(
      (b) => !b.blocked_until || Date.parse(b.blocked_until) > at,
    ),
    discovering = jobs.some(
      (j) =>
        j.type === "discovery" &&
        (j.status === "running" || j.status === "queued"),
    );
  const listed = jobs.filter(filters[filter].match);
  const pageCount = Math.max(1, Math.ceil(listed.length / jobsPerPage));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = listed.slice(
    currentPage * jobsPerPage,
    (currentPage + 1) * jobsPerPage,
  );
  async function resumeProvider(provider: string) {
    setResuming(provider);
    setResumeError("");
    try {
      await api(`/operations/providers/${provider}/resume`, {}, "POST");
      setRevision((n) => n + 1);
    } catch (e) {
      setResumeError((e as Error).message);
    } finally {
      setResuming(null);
    }
  }
  const budgets = operations?.budgets,
    usage = operations?.usage,
    summary = operations?.summary;
  return (
    <div className="auto-page">
      <section className={`auto-status ${status.tone}`} role="status">
        <i aria-hidden="true" />
        <div>
          <strong>
            {statusError && !operations ? "Status unavailable" : status.title}
          </strong>
          <small>{statusError || status.detail}</small>
        </div>
        {usage && (
          <dl title="Requests reset at 8:00 AM PHT">
            <dt>Requests today</dt>
            <dd>
              {usage.units} / {budgets?.daily_api_budget ?? "—"}
            </dd>
          </dl>
        )}
        {status.action === "watch" && (
          <Button size="sm" onClick={() => navigate(`/jobs/${running[0].id}`)}>
            <Activity size={14} /> Watch live
          </Button>
        )}
        {status.action === "attention" && (
          <Button size="sm" onClick={() => setFilter("attention")}>
            Review
          </Button>
        )}
      </section>
      {status.action === "worker" && (
        <p className="auto-worker-help">
          The worker is the background process that runs your jobs. Start it on
          your Mac: <code>npm run mac:worker restart</code>
        </p>
      )}
      {loaded && !jobs.length && (
        <section className="panel auto-first">
          <h2>How Scout works</h2>
          <ol>
            <li>
              <Search size={18} />
              <strong>Find stores</strong>
              <span>A discovery searches for Shopify stores you can help.</span>
            </li>
            <li>
              <Activity size={18} />
              <strong>Audit them</strong>
              <span>Scout tests each store and records what it finds.</span>
            </li>
            <li>
              <Store size={18} />
              <strong>Review leads</strong>
              <span>Qualified stores land in Leads, with the evidence.</span>
            </li>
          </ol>
          <div>
            <Button onClick={onNewDiscovery}>
              <Plus size={14} /> Start first discovery
            </Button>
            <Button variant="ghost" onClick={() => navigate("/jobs/sample")}>
              <Play size={14} /> Play a sample
            </Button>
          </div>
        </section>
      )}
      {(attention.length > 0 || paused.length > 0) && (
        <section className="panel auto-attention">
          <header>
            <h2>Needs attention</h2>
            {resumable.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onBulk(resumable, "retry")}
              >
                {jobAction === "bulk" ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Resume all ({resumable.length})
              </Button>
            )}
          </header>
          {resumeError && (
            <p className="error-banner" role="alert">
              {resumeError}
            </p>
          )}
          {paused.map((block) => (
            <div className="auto-attention-row" key={block.provider}>
              <AlertCircle size={16} />
              <div>
                <strong>{block.provider} is paused</strong>
                <small>
                  {block.blocked_until
                    ? `Resumes ${philippineTime(block.blocked_until)}. ${block.reason}`
                    : block.reason}
                </small>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!!resuming}
                onClick={() => void resumeProvider(block.provider)}
              >
                {resuming === block.provider ? "Resuming…" : "Resume now"}
              </Button>
            </div>
          ))}
          {attention.map((job) => (
            <div className="auto-attention-row" key={job.id}>
              <AlertCircle size={16} />
              <div>
                <strong>{jobName(job)}</strong>
                <small>
                  {job.error ?? jobPresentation(job, operations).detail}
                </small>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/jobs/${job.id}`)}
              >
                Open
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onRetry(job)}
              >
                {job.error_code === "search_limit" ? "New discovery" : "Resume"}
              </Button>
            </div>
          ))}
        </section>
      )}
      {running.length > 0 && (
        <section className="panel auto-running">
          <header>
            <h2>Running now</h2>
            {queued.length > 0 && <span>{queued.length} more waiting</span>}
          </header>
          {running.map((job) => {
            const latest = readWork(job.payload.work)?.events.at(-1)?.message;
            return (
              <article key={job.id}>
                <div>
                  <h3>{jobName(job)}</h3>
                  <div className="job-controls">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/jobs/${job.id}`)}
                    >
                      <Activity size={14} /> Watch live
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onCancel(job)}
                    >
                      <Square size={13} /> Stop
                    </Button>
                  </div>
                </div>
                <ol className="auto-stages" aria-label="Job stages">
                  {stagesFor(job.type).map((stage) => (
                    <li key={stage} className={stageState(job, stage)}>
                      {workStages[stage]}
                    </li>
                  ))}
                </ol>
                <div className="job-progress">
                  <span>
                    <i style={{ width: `${job.progress}%` }} />
                  </span>
                  <small>{job.progress}%</small>
                </div>
                {latest && <p className="auto-latest">{latest}</p>}
              </article>
            );
          })}
          <div className="auto-map">
            {session({ selected: running[0].id, mode: "compact" })}
          </div>
        </section>
      )}
      {summary && (
        <section className="panel auto-today" aria-label="Today so far">
          <header>
            <h2>Today so far</h2>
            <span>Resets at 8:00 AM PHT</span>
          </header>
          <div>
            <TodayItem
              label="Stores found"
              value={summary.stores_found}
              onClick={() => navigate("/discovery")}
            />
            <TodayItem
              label="Audits finished"
              value={summary.audits_completed}
              onClick={() => navigate("/audits")}
            />
            <TodayItem
              label="New leads"
              value={summary.new_leads}
              onClick={() => navigate("/leads")}
            />
            <TodayItem
              label="Failed"
              value={summary.failures}
              onClick={() => {
                setFilter("attention");
                setPage(0);
              }}
            />
          </div>
        </section>
      )}
      {jobs.length > 0 && (
        <section className="panel auto-jobs">
          <header>
            <div className="job-filters">
              {(Object.keys(filters) as Filter[]).map((key) => (
                <button
                  key={key}
                  className={filter === key ? "active" : ""}
                  aria-pressed={filter === key}
                  onClick={() => {
                    setFilter(key);
                    setPage(0);
                  }}
                >
                  {filters[key].label}
                  <span>{jobs.filter(filters[key].match).length}</span>
                </button>
              ))}
            </div>
            <div className="auto-jobs-actions">
              {filter === "active" && queued.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmCancel(true)}
                >
                  <Square size={13} /> Cancel queued ({queued.length})
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/jobs/sample")}
              >
                <Play size={13} /> Sample
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Refresh jobs"
                onClick={onRefresh}
              >
                <RefreshCw size={14} className={loading ? "spin" : ""} />
              </Button>
            </div>
          </header>
          <div className="job-list">
            {visible.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                demo={demo}
                busy={busy}
                operations={operations}
                lead={leadFor(job)}
                cancelling={jobAction === job.id}
                resuming={jobAction === `retry:${job.id}`}
                onCancel={() => onCancel(job)}
                onRetry={() => onRetry(job)}
                onOpen={() => navigate(`/jobs/${job.id}`)}
                onOpenLead={onOpenLead}
                onLeads={() => navigate("/leads")}
              />
            ))}
            {!listed.length && (
              <p className="auto-none">
                <Workflow size={16} /> No jobs in this view.
              </p>
            )}
          </div>
          {pageCount > 1 && (
            <nav className="auto-pages" aria-label="Jobs pages">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <span role="status" aria-live="polite">
                {currentPage * jobsPerPage + 1}–
                {Math.min((currentPage + 1) * jobsPerPage, listed.length)} of{" "}
                {listed.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage + 1 >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </nav>
          )}
        </section>
      )}
      {(!!operations?.schedules.length || scheduled || discovering) && (
        <details className="panel auto-schedules">
          <summary>
            Schedules
            <span>
              {operations?.schedules.filter((s) => s.enabled).length ?? 0} on
            </span>
          </summary>
          <p>
            Audits go first: new discovery waits while{" "}
            {budgets?.max_audit_backlog ?? 5} or more are in the queue.
          </p>
          {operations?.schedules.map((schedule) => (
            <div key={schedule.id}>
              <strong>{schedule.name}</strong>
              <span>
                {!schedule.enabled
                  ? "Off"
                  : Date.parse(schedule.next_run_at) <= at
                    ? "Due · starts when the queue has room"
                    : `Next run ${philippineTime(schedule.next_run_at)}`}
              </span>
            </div>
          ))}
          {(scheduled || discovering) && (
            <DiscoveryControls
              scheduled={scheduled}
              busy={busy}
              stopping={jobAction === "discovery"}
              onStop={onStopDiscovery}
            />
          )}
        </details>
      )}
      <Dialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`Cancel ${queued.length} queued ${queued.length === 1 ? "job" : "jobs"}?`}
        description="They won't run. Jobs already running keep going."
      >
        <div className="auto-confirm">
          <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
            Keep them
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmCancel(false);
              onBulk(queued, "cancel");
            }}
          >
            Cancel queued jobs
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
function TodayItem({
  label,
  value,
  onClick,
}: {
  label: string;
  value: ReactNode;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick}>
      <strong>{value}</strong>
      <span>
        {label} <ArrowRight size={12} />
      </span>
    </button>
  );
}
function JobRow({
  job,
  demo,
  busy,
  operations,
  lead,
  cancelling,
  resuming,
  onCancel,
  onRetry,
  onOpen,
  onOpenLead,
  onLeads,
}: {
  job: Job;
  demo: boolean;
  busy: boolean;
  operations: OperationsSnapshot | null;
  lead?: Lead;
  cancelling: boolean;
  resuming: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onOpen: () => void;
  onOpenLead: (lead: Lead) => void;
  onLeads: () => void;
}) {
  const presentation = jobPresentation(job, operations);
  const funnel = job.payload.funnel as Record<string, unknown> | undefined;
  const requests = Object.values(job.api_usage).reduce(
    (n, v) => n + Number(v),
    0,
  );
  return (
    <article className="job-row">
      <div className={`job-icon ${job.status === "failed" ? "red" : ""}`}>
        {job.type === "discovery" ? (
          <Compass size={20} />
        ) : (
          <Activity size={20} />
        )}
      </div>
      <div className="job-main">
        <div>
          <h3>{jobName(job)}</h3>
          <span
            className={`badge ${job.status === "completed" ? "green" : job.status === "failed" ? "red" : job.status === "running" ? "teal" : job.status === "blocked" ? "amber" : ""}`}
          >
            {demo ? "Sample " : ""}
            {presentation.label}
          </span>
        </div>
        <p title={`Job ${job.id}`}>
          {formatDate(job.created_at)}
          {job.attempts > 1 && ` · Try ${job.attempts} of ${job.max_attempts}`}
          {requests > 0 &&
            ` · ${requests} ${requests === 1 ? "request" : "requests"}`}
        </p>
        {presentation.detail && (
          <p className="job-wait-reason" role="status">
            {presentation.detail}
          </p>
        )}
        {Number(job.payload.resumed_samples) > 0 && (
          <p className="job-resume-note">
            Reused {Number(job.payload.resumed_samples)} saved PageSpeed
            measurements (up to 24 hours old).
          </p>
        )}
        {typeof job.payload.result === "string" && (
          <details className="research-run-outcome">
            <summary>{job.payload.result.split(". ")[0]}</summary>
            <p>{job.payload.result}</p>
          </details>
        )}
        {job.type === "discovery" && !!funnel && (
          <details className="research-run-outcome">
            <summary>What it found</summary>
            <DiscoveryFunnel value={funnel} />
          </details>
        )}
        {(job.status === "running" || job.status === "queued") && (
          <div className="job-progress">
            <span>
              <i style={{ width: `${job.progress}%` }} />
            </span>
            <small>{job.progress}%</small>
          </div>
        )}
        {job.error && (
          <details
            className="job-diagnostic"
            open={job.status === "blocked" || job.status === "failed"}
          >
            <summary>What went wrong</summary>
            <p className="job-error">
              <AlertCircle size={13} />
              {job.error}
            </p>
          </details>
        )}
      </div>
      <div className="job-controls">
        {lead && job.status === "completed" && (
          <Button variant="outline" size="sm" onClick={() => onOpenLead(lead)}>
            Open lead
          </Button>
        )}
        {job.type === "discovery" && job.status === "completed" && (
          <Button variant="outline" size="sm" onClick={onLeads}>
            Go to Leads
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onOpen}>
          {job.status === "running" ? "Watch live" : "Details"}
        </Button>
        {canResume(job) && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>
            {resuming && <LoaderCircle size={14} className="spin" />}
            {resuming
              ? "Resuming…"
              : job.error_code === "search_limit"
                ? "New discovery"
                : "Resume"}
          </Button>
        )}
        {canCancel(job) && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancel}
            aria-label={`Cancel ${job.type === "discovery" ? "discovery" : "audit"} job ${job.id}`}
          >
            {cancelling ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Square size={13} />
            )}
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>
    </article>
  );
}
