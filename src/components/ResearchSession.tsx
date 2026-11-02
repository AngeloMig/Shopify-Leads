import { useEffect, useMemo, useRef, useState } from "react";
import type { RunStar } from "./research-network-model";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Compass,
  Copy,
  ExternalLink,
  FileText,
  Globe2,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Square,
  X,
  AlertCircle,
} from "lucide-react";
import type { Job } from "../../shared/types";
import {
  publicActivityUrl,
  readWork,
  stagesFor,
  stageState,
  targetFor,
  workStages,
  type RunDetail,
  type WorkStage,
} from "../../shared/job-activity";
import {
  jobPresentation,
  onlineWorkers,
  type OperationsSnapshot,
} from "../../shared/automation";
import { api } from "../lib";
import { Button } from "./ui/button";
import { previewLength, previewRun } from "./research-preview";
import { PageSpeedAudit } from "./PageSpeedAudit";
import ResearchNetwork from "./ResearchNetwork";
import {
  researchTasks,
  isWorkingTask,
  isIssueTask,
  taskStatus,
} from "../../shared/research-tasks";
const time = (value: string) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
const isActive = (j: Job) => ["queued", "running"].includes(j.status);
export function ResearchSession({
  jobs,
  selected,
  onSelect,
  operations,
  live,
  onCancel,
  onRetry,
  busy,
  onAll,
  onReports,
  mode = "full",
  sample,
  onLead,
}: {
  jobs: Job[];
  selected: string;
  onSelect: (id: string) => void;
  operations: OperationsSnapshot | null;
  live: boolean;
  onCancel: (job: Job) => void;
  onRetry: (job: Job) => void;
  busy: boolean;
  onAll: () => void;
  onReports: () => void;
  /** "compact" is the map alone, for the main Automation Jobs page. */
  mode?: "full" | "compact";
  sample?: Job["type"];
  onLead?: () => void;
}) {
  const [preview, setPreview] = useState<Job["type"] | null>(sample ?? null),
    [tick, setTick] = useState(0),
    [playing, setPlaying] = useState(!!sample),
    [previewBase, setPreviewBase] = useState(Date.now()),
    [detail, setDetail] = useState<RunDetail | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [focused, setFocused] = useState<WorkStage | null>(null),
    [selectedTask, setSelectedTask] = useState<string | null>(null),
    [activityFilter, setActivityFilter] = useState<
      "All" | "Running" | "Completed" | "Issues"
    >("All"),
    [feedLimit, setFeedLimit] = useState(100),
    [receivedAt, setReceivedAt] = useState<number | null>(null),
    [tab, setTab] = useState<"activity" | "evidence">("activity"),
    [follow, setFollow] = useState(true),
    [copied, setCopied] = useState(false),
    [revision, setRevision] = useState(0),
    [reportError, setReportError] = useState("");
  const feed = useRef<HTMLDivElement>(null);
  const loadedKey = useRef("");
  const ordered = useMemo(
    () =>
      [...jobs].sort(
        (a, b) =>
          (a.status === "running" ? 0 : a.status === "queued" ? 1 : 2) -
            (b.status === "running" ? 0 : b.status === "queued" ? 1 : 2) ||
          Date.parse(b.created_at) - Date.parse(a.created_at),
      ),
    [jobs],
  );
  const chosen = jobs.find((j) => j.id === selected) ?? ordered[0];
  const runStars = useMemo<RunStar[]>(
    () =>
      ordered.slice(0, 24).map((j) => {
        const funnel = j.payload.funnel as Record<string, unknown> | undefined;
        return {
          id: j.id,
          label: targetFor(j).label,
          kind: j.type,
          status: j.status,
          leads: typeof funnel?.queued === "number" ? funnel.queued : 0,
        };
      }),
    [ordered],
  );
  useEffect(() => {
    const key = preview ?? chosen?.id ?? "";
    if (loadedKey.current !== key) {
      setFocused(null);
      setSelectedTask(null);
      setFollow(true);
      setTab("activity");
      setCopied(false);
      setFeedLimit(100);
      setReceivedAt(null);
      setReportError("");
      setDetail(null);
      loadedKey.current = key;
    }
    if (preview || !live || !chosen) {
      setLoading(false);
      setDetail(null);
      setError("");
      return;
    }
    let active = true,
      working = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    setLoading(true);
    const load = async () => {
      if (working) return;
      working = true;
      try {
        const d = await api<RunDetail>(`/jobs/${chosen.id}/activity`);
        if (active) {
          setDetail(d);
          setReceivedAt(Date.now());
          setError("");
          if (!isActive(d.job) && timer) clearInterval(timer);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        working = false;
        if (active) setLoading(false);
      }
    };
    void load();
    if (isActive(chosen))
      timer = setInterval(
        () => void load(),
        chosen.status === "running" ? 3000 : 12000,
      );
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [chosen?.id, chosen?.status, chosen?.attempts, live, preview, revision]);
  useEffect(() => {
    if (!preview || !playing) return;
    const timer = setInterval(
      () => setTick((n) => Math.min(n + 1, previewLength(preview) - 1)),
      2200,
    );
    return () => clearInterval(timer);
  }, [preview, playing]);
  useEffect(() => {
    if (preview && tick >= previewLength(preview) - 1) setPlaying(false);
  }, [preview, tick]);
  const data = preview ? previewRun(preview, tick, previewBase) : detail;
  const job = data?.job ?? chosen;
  // Job lists carry only the latest events; the full log arrives with the detail.
  const awaitingActivity = live && !data && !!job;
  const work = readWork(job?.payload.work),
    target =
      data?.target ??
      (job ? targetFor(job) : { label: "Your next research run" });
  const tasks = useMemo(() => researchTasks(data ?? null), [data]);
  const eventTasks = useMemo(
    () =>
      new Map(tasks.flatMap((t) => t.events.map((e) => [e.id, t] as const))),
    [tasks],
  );
  const events = work?.events ?? [];
  const matched = events.filter((e) => {
    const task = eventTasks.get(e.id);
    if (
      selectedTask ? task?.id !== selectedTask : focused && e.stage !== focused
    )
      return false;
    return (
      activityFilter === "All" ||
      (!!task &&
        (activityFilter === "Running"
          ? isWorkingTask(task.state)
          : activityFilter === "Completed"
            ? task.state === "completed"
            : isIssueTask(task.state)))
    );
  });
  const shown = matched.slice(-feedLimit);
  const last = events.at(-1),
    terminal = job && !isActive(job);
  const connected = preview
    ? playing
    : !!operations &&
      onlineWorkers(operations).some((w) => w.state !== "paused");
  const active = !!job && job.status === "running" && connected && !error;
  const presentation = job
    ? jobPresentation(job, preview || !live ? null : operations)
    : null;
  const stage = focused ?? work?.stage ?? stagesFor(job?.type ?? "audit")[0];
  const allStages = stagesFor(job?.type ?? "audit");
  const stageDetail = (state: string) =>
    state === "active" && !active
      ? "Last recorded stage"
      : state === "active"
        ? "In progress"
        : state === "completed"
          ? "Done"
          : state === "skipped"
            ? "Not needed"
            : state === "attention"
              ? "Needs attention"
              : state === "cancelled"
                ? "Stopped"
                : state === "recorded"
                  ? "Activity recorded"
                  : terminal
                    ? "No stage history"
                    : preview
                      ? "Up next"
                      : "Waiting";
  useEffect(() => {
    if (follow && feed.current && !focused)
      feed.current.scrollTop = feed.current.scrollHeight;
  }, [last?.id, follow, focused, preview]);
  const startPreview = (type: Job["type"]) => {
    setPreview(type);
    setTick(0);
    setPreviewBase(Date.now());
    setPlaying(true);
    setFocused(null);
    setSelectedTask(null);
    setActivityFilter("All");
    setFeedLimit(100);
    setFollow(true);
    setTab("activity");
  };
  const latest = (strategy: string) =>
    data?.measurements
      .filter((m) => m.strategy === strategy)
      .sort((a, b) => a.sample - b.sample)
      .at(-1);
  const mobile = latest("mobile"),
    desktop = latest("desktop");
  const title = error
    ? "Updates interrupted"
    : preview
      ? playing
        ? "Playing sample run"
        : terminal
          ? "Sample run complete"
          : "Sample paused"
      : (presentation?.label ?? "Ready when you are");
  const links = data?.pages.filter((p) => publicActivityUrl(p.url)) ?? [];
  async function openFinishedReport() {
    if (preview || !data?.report_id) return;
    setReportError("");
    try {
      const { url } = await api<{ url: string }>(
        `/reports/${data.report_id}/download`,
      );
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noreferrer";
      link.click();
    } catch (e) {
      setReportError(
        e instanceof Error ? e.message : "The report could not be opened.",
      );
    }
  }
  async function copy() {
    if (!job) return;
    try {
      await navigator.clipboard.writeText(
        `${preview ? "SAMPLE RUN\n" : ""}${target.label}\n${target.domain ?? ""}\n${presentation?.label}\n${last?.message ?? ""}\nRun: ${job.id}`,
      );
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <section
      className={`research-session ${mode === "compact" ? "is-compact" : ""}`}
      aria-label={mode === "compact" ? "Live job map" : "Job details"}
    >
      <header className="research-header">
        <div>
          <span className="research-mark">
            <Compass size={19} />
          </span>
          <div>
            <button className="research-back" onClick={onAll}>
              <ArrowLeft size={13} />
              All jobs
            </button>
            <h2>{preview ? "Sample run" : target.label}</h2>
            <p>
              {preview
                ? "See how a job looks while Scout works."
                : `${job?.type === "audit" ? "Website audit" : "Store discovery"} · ${title}`}
            </p>
          </div>
        </div>
        <div className="research-header-actions">
          {preview && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startPreview("discovery")}
              >
                <Play size={13} />
                Sample discovery
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startPreview("audit")}
              >
                <Play size={13} />
                Sample audit
              </Button>
            </>
          )}
          {!preview && onLead && job?.status === "completed" && (
            <Button size="sm" onClick={onLead}>
              Open lead
            </Button>
          )}
          {!preview && data?.report_id && (
            <Button size="sm" variant="outline" onClick={onReports}>
              <FileText size={13} />
              View reports
            </Button>
          )}
          {!preview && job && ["blocked", "failed"].includes(job.status) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onRetry(job)}
            >
              <RefreshCw size={13} />
              Resume
            </Button>
          )}
          {!preview &&
            job &&
            ["running", "queued", "blocked"].includes(job.status) && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                aria-label="Stop this job"
                onClick={() => onCancel(job)}
              >
                <Square size={12} />
                Stop job
              </Button>
            )}
        </div>
      </header>
      {preview && (
        <div className="research-preview-notice" role="status">
          <span>
            <strong>Sample run</strong> · Fictional data. Starts no real work.
          </span>
          <div className="research-preview-controls">
            <button
              aria-label={
                playing
                  ? "Pause sample playback"
                  : terminal
                    ? "Replay sample playback"
                    : "Resume sample playback"
              }
              onClick={() => {
                if (terminal) setTick(0);
                setPlaying(!playing);
              }}
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}{" "}
              {playing ? "Pause" : terminal ? "Replay" : "Play"}
            </button>
            <button
              onClick={() => {
                setPlaying(false);
                setTick((n) => Math.min(n + 1, previewLength(preview) - 1));
              }}
              disabled={terminal}
              aria-label="Next sample event"
            >
              <ChevronRight size={14} />
              Next event
            </button>
            <button onClick={onAll} aria-label="Close sample run">
              <X size={15} />
              <span>Back to jobs</span>
            </button>
          </div>
        </div>
      )}
      <div className="research-layout">
        <div className="research-main" aria-busy={loading && !data}>
          <div className={`research-focus ${active ? "is-working" : ""}`}>
            <div className="research-focus-top">
              <span className="research-address">
                <Globe2 size={13} />
                {target.domain ??
                  (job?.type === "discovery"
                    ? "Campaign discovery"
                    : "Public website research")}
              </span>
              <span className="research-live-state">
                <i />
                {preview
                  ? "PREVIEW"
                  : active
                    ? "LIVE"
                    : error
                      ? "RECONNECTING"
                      : job?.status === "queued"
                        ? "QUEUED"
                        : job?.status === "running"
                          ? "NOT CONNECTED"
                          : "FINISHED"}
              </span>
            </div>
            <ResearchNetwork
              key={job?.id ?? "empty"}
              runKey={job?.id ?? "empty"}
              detail={data ?? null}
              kind={job?.type ?? "audit"}
              targetLabel={target.label}
              onEvidence={() => {
                const evidenceTab =
                  job?.type === "discovery" ? "activity" : "evidence";
                setTab(evidenceTab);
                requestAnimationFrame(() =>
                  document
                    .getElementById(`research-${evidenceTab}-panel`)
                    ?.scrollIntoView({
                      block: "nearest",
                      behavior: window.matchMedia(
                        "(prefers-reduced-motion: reduce)",
                      ).matches
                        ? "auto"
                        : "smooth",
                    }),
                );
              }}
              stages={allStages.map((id) => {
                const state = job ? stageState(job, id) : "pending";
                return {
                  id,
                  label: workStages[id],
                  state,
                  detail: stageDetail(state),
                };
              })}
              selected={focused}
              onSelect={(s) => {
                setFocused(s);
                setSelectedTask(null);
                setFollow(false);
                setTab("activity");
              }}
              active={active}
              selectedTask={selectedTask}
              onTaskSelect={setSelectedTask}
              follow={follow}
              onFollow={(value) => {
                setFollow(value);
                if (value) {
                  setFocused(null);
                  setSelectedTask(null);
                  setActivityFilter("All");
                }
              }}
              streamState={
                preview
                  ? playing
                    ? "Sample playing"
                    : "Sample paused"
                  : error
                    ? "Updates disconnected"
                    : job?.status === "running" && !connected
                      ? "Worker offline"
                      : job?.status === "running"
                        ? "Live"
                        : job?.status === "queued"
                          ? "Waiting to start"
                          : "Saved run"
              }
              receivedAt={preview ? null : receivedAt}
              onReport={() => void openFinishedReport()}
              preview={!!preview}
              runs={runStars}
              onRunSelect={(id) => {
                onSelect(id);
                setPreview(null);
                setPlaying(false);
              }}
            />
            <div className="research-focus-bottom">
              <span>
                <span className={`research-state-dot ${active ? "on" : ""}`} />
                {title}
              </span>
              <span>
                {job
                  ? `${preview ? "Sample" : "Attempt"} ${job.attempts}${!preview ? ` of ${job.max_attempts}` : ""}`
                  : "No run selected"}
                {job &&
                  ` · ${tasks.filter((t) => t.state === "completed").length} tasks completed`}
              </span>
            </div>
          </div>
          {reportError && (
            <div className="research-update-error" role="alert">
              <AlertCircle size={15} />
              <span>{reportError}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void openFinishedReport()}
              >
                Retry report
              </Button>
            </div>
          )}
          {error && (
            <div className="research-update-error" role="alert">
              <AlertCircle size={15} />
              <span>{error} · Showing the last recorded activity.</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRevision((n) => n + 1)}
              >
                Retry updates
              </Button>
            </div>
          )}
          <div className="research-tabs">
            <div
              role="tablist"
              aria-label="Run detail views"
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                  return;
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? "activity"
                    : e.key === "End"
                      ? "evidence"
                      : tab === "activity"
                        ? "evidence"
                        : "activity";
                setTab(next);
                document
                  .getElementById(
                    next === "activity"
                      ? "research-activity-tab"
                      : "research-evidence-tab",
                  )
                  ?.focus();
              }}
            >
              <button
                role="tab"
                id="research-activity-tab"
                aria-controls="research-activity-panel"
                aria-selected={tab === "activity"}
                tabIndex={tab === "activity" ? 0 : -1}
                onClick={() => setTab("activity")}
              >
                Activity <span>{events.length}</span>
              </button>
              <button
                role="tab"
                id="research-evidence-tab"
                aria-controls="research-evidence-panel"
                aria-selected={tab === "evidence"}
                tabIndex={tab === "evidence" ? 0 : -1}
                onClick={() => setTab("evidence")}
              >
                Pages & signals <span>{links.length}</span>
              </button>
            </div>
            <span
              className="research-live-announcement"
              role="status"
              aria-live="polite"
            >
              {active ? last?.message : title}
            </span>
          </div>
          {tab === "activity" ? (
            <div
              id="research-activity-panel"
              role="tabpanel"
              aria-labelledby="research-activity-tab"
              className="research-activity-panel"
            >
              <div className="research-feed-toolbar">
                <span>
                  {selectedTask
                    ? tasks.find((t) => t.id === selectedTask)?.name
                    : focused
                      ? workStages[focused]
                      : "All stages"}{" "}
                  · Times in PHT
                </span>
                {focused ? (
                  <button
                    onClick={() => {
                      setFocused(null);
                      setSelectedTask(null);
                      setFollow(true);
                    }}
                  >
                    Show all activity
                  </button>
                ) : (
                  <button
                    aria-pressed={follow}
                    onClick={() => setFollow(!follow)}
                  >
                    {follow ? <Check size={12} /> : <ChevronDown size={12} />}
                    Follow live activity
                  </button>
                )}
              </div>
              <div
                className="research-task-filters"
                aria-label="Filter recorded activity"
              >
                {(["All", "Running", "Completed", "Issues"] as const).map(
                  (filter) => (
                    <button
                      key={filter}
                      aria-pressed={activityFilter === filter}
                      onClick={() => {
                        setActivityFilter(filter);
                        setFeedLimit(100);
                      }}
                    >
                      {filter}
                    </button>
                  ),
                )}
                <span>{matched.length} updates</span>
              </div>
              <div
                className="research-feed"
                ref={feed}
                onWheel={() => setFollow(false)}
                onTouchMove={() => setFollow(false)}
                role="log"
                aria-live="off"
                aria-label="Recorded research activity"
              >
                {matched.length > shown.length && (
                  <button
                    className="research-load-history"
                    onClick={() => {
                      setFeedLimit((n) => n + 100);
                      setFollow(false);
                    }}
                  >
                    Show 100 older updates · {matched.length - shown.length}{" "}
                    remaining
                  </button>
                )}
                {shown.map((e, i) => (
                  <article
                    className={`research-event ${i === shown.length - 1 && active ? "newest" : ""} ${selectedTask && eventTasks.get(e.id)?.id === selectedTask ? "task-selected" : ""}`}
                    key={e.id}
                  >
                    <time dateTime={e.at}>{time(e.at)}</time>
                    <span className={`research-event-icon ${e.state}`}>
                      {e.task_state === "failed" ||
                      e.task_state === "retrying" ||
                      e.task_state === "interrupted" ? (
                        <AlertCircle size={12} />
                      ) : e.task_state === "waiting" ||
                        e.task_state === "queued" ? (
                        <Clock3 size={12} />
                      ) : e.state === "completed" ||
                        e.task_state === "completed" ? (
                        <Check size={12} />
                      ) : e.state === "started" &&
                        i === shown.length - 1 &&
                        active ? (
                        <LoaderCircle size={12} />
                      ) : e.state === "skipped" ? (
                        <ArrowRight size={12} />
                      ) : (
                        <span />
                      )}
                    </span>
                    <div>
                      <button
                        className="research-event-select"
                        onClick={() => {
                          const task = eventTasks.get(e.id);
                          if (task) {
                            setSelectedTask(task.id);
                            setFocused(task.stage);
                            setFollow(false);
                          }
                        }}
                        aria-label={`Inspect task: ${e.message}`}
                      >
                        {e.message}
                      </button>
                      {e.task_state && (
                        <small className="research-event-status">
                          {taskStatus[e.task_state]}
                        </small>
                      )}
                      {e.url && (
                        <a
                          href={preview ? undefined : e.url}
                          aria-disabled={preview ? true : undefined}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {new URL(e.url).hostname}
                          {new URL(e.url).pathname !== "/"
                            ? new URL(e.url).pathname
                            : ""}
                          {!preview && <ArrowUpRight size={11} />}
                        </a>
                      )}
                      {typeof e.facts?.query === "string" && (
                        <code>{e.facts.query}</code>
                      )}
                      {typeof e.facts?.pages === "number" && (
                        <small>
                          {e.facts.pages} pages ·{" "}
                          {typeof e.facts.findings === "number"
                            ? `${e.facts.findings} observations`
                            : "Reviewing page evidence"}
                          {typeof e.facts.emails === "number"
                            ? ` · ${e.facts.emails} public email(s)`
                            : ""}
                        </small>
                      )}
                      {typeof e.facts?.performance === "number" && (
                        <small>
                          Performance {e.facts.performance}/100 · SEO{" "}
                          {typeof e.facts.seo === "number"
                            ? `${e.facts.seo}/100`
                            : "unavailable"}
                          {e.facts.reused ? " · Saved measurement" : ""}
                        </small>
                      )}
                    </div>
                  </article>
                ))}
                {!shown.length && awaitingActivity && (
                  <div className="research-feed-empty">
                    <Clock3 size={22} />
                    <strong>
                      {error
                        ? "This run’s activity couldn’t be loaded"
                        : "Loading this run’s activity…"}
                    </strong>
                  </div>
                )}
                {!shown.length && !awaitingActivity && (
                  <div className="research-feed-empty">
                    <Clock3 size={22} />
                    <strong>
                      {focused
                        ? "No recorded activity for this stage"
                        : job
                          ? "Detailed activity wasn’t recorded for this run"
                          : "Ready to follow your first run"}
                    </strong>
                    <p>
                      {job?.status === "queued"
                        ? "The feed begins when the worker starts this run."
                        : work
                          ? "Completed checks will appear here as they are saved."
                          : "New runs will include step-by-step updates. Existing results and reports are still available."}
                    </p>
                    {!preview && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startPreview(job?.type ?? "audit")}
                      >
                        <Play size={13} />
                        Play a sample run
                      </Button>
                    )}
                  </div>
                )}
                {terminal && !focused && (
                  <div className={`research-terminal ${job?.status}`}>
                    {job?.status === "completed" ? (
                      <Check size={15} />
                    ) : job?.status === "cancelled" ? (
                      <Square size={15} />
                    ) : (
                      <AlertCircle size={15} />
                    )}
                    <div>
                      <strong>
                        {job?.status === "completed"
                          ? "Run finished"
                          : job?.status === "cancelled"
                            ? "Run stopped"
                            : "Run needs review"}
                      </strong>
                      <p>
                        {job?.error ??
                          (data?.report_id
                            ? "The private audit report is available."
                            : typeof job?.payload.result === "string"
                              ? job.payload.result
                              : "Review the retained evidence and run outcome below.")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              id="research-evidence-panel"
              role="tabpanel"
              aria-labelledby="research-evidence-tab"
              className="research-evidence-panel"
            >
              <PageSpeedAudit
                key={job?.id}
                pending={loading}
                mobile={{
                  scores: mobile?.scores ?? {},
                  note: mobile
                    ? `Latest recorded sample ${mobile.sample} of 3 · out of 100`
                    : "No mobile measurement recorded yet.",
                  testedAt: mobile?.tested_at,
                  url: preview ? undefined : data?.target.url,
                }}
                desktop={{
                  scores: desktop?.scores ?? {},
                  note: desktop
                    ? `Latest recorded sample ${desktop.sample} of 3 · out of 100`
                    : "No desktop measurement recorded yet.",
                  testedAt: desktop?.tested_at,
                  url: preview ? undefined : data?.target.url,
                }}
              />
              <div className="research-page-map">
                <h4>Pages observed</h4>
                {links.length ? (
                  <ul>
                    {links.map((p, i) => (
                      <li key={`${p.url}-${i}`}>
                        <span className="research-page-branch" />
                        <a
                          href={preview ? undefined : publicActivityUrl(p.url)}
                          aria-disabled={preview ? true : undefined}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Globe2 size={13} />
                          <span>
                            {new URL(p.url).pathname || "Homepage"}
                            <small>{p.kind}</small>
                          </span>
                          <span className="research-http">
                            {p.status_code ?? "—"}
                          </span>
                          {!preview && <ArrowUpRight size={12} />}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    Observed pages appear as their audit evidence is saved. No
                    website screenshot is implied.
                  </p>
                )}
              </div>
              {!!data?.findings.length && (
                <div className="research-findings">
                  <h4>Recorded observations</h4>
                  {data.findings.slice(0, 4).map((f, i) => (
                    <div key={i}>
                      <span>{f.category}</span>
                      <p>{f.title}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <footer className="research-footer">
            <div>
              {preview ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (terminal) setTick(0);
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? <Pause size={13} /> : <Play size={13} />}{" "}
                    {playing
                      ? "Pause preview"
                      : terminal
                        ? "Replay preview"
                        : "Play preview"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTick(0);
                      setPlaying(false);
                    }}
                  >
                    Restart
                  </Button>
                </>
              ) : job ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => void copy()}>
                    <Copy size={13} />
                    {copied ? "Copied" : "Copy summary"}
                  </Button>
                  {publicActivityUrl(target.url) && (
                    <a
                      className="research-visit"
                      href={publicActivityUrl(target.url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Visit website
                      <ExternalLink size={12} />
                    </a>
                  )}
                </>
              ) : null}
            </div>
          </footer>
        </div>
      </div>
    </section>
  );
}
