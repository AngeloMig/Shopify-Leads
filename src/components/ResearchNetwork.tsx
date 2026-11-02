import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Network,
  Pause,
  Play,
  RotateCcw,
  Maximize2,
  Minimize2,
  ArrowUpRight,
  Check,
  Clock3,
  AlertCircle,
  Focus,
  FileText,
  Layers,
} from "lucide-react";
import {
  readWork,
  workStages,
  type RunDetail,
  type WorkStage,
} from "../../shared/job-activity";
import {
  isWorkingTask,
  isIssueTask,
  researchTasks,
  resultSummary,
  taskStatus,
  type ResearchTask,
} from "../../shared/research-tasks";
import type { NetworkStage, RunStar } from "./research-network-model";
import "../neural-network.css";
import ResearchModel from "./ResearchModel";
import TaskFlowMap from "./TaskFlowMap";
import { lighthouseScore } from "../../shared/lighthouse-score";
import ScoutCoreStatus from "./ScoutCoreStatus";
import {
  coreState,
  coreEvidence,
  type CorePalette,
  type CoreAppearance,
} from "./scout-core-model";
const pht = (at: string) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(at));
class CoreBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
function StatusIcon({ task }: { task: ResearchTask }) {
  return task.state === "completed" ? (
    <Check size={12} />
  ) : isIssueTask(task.state) ? (
    <AlertCircle size={12} />
  ) : task.state === "waiting" || task.state === "queued" ? (
    <Clock3 size={12} />
  ) : (
    <span />
  );
}
export default function ResearchNetwork({
  stages,
  kind,
  selected,
  onSelect,
  active,
  runKey,
  detail,
  targetLabel,
  onEvidence,
  selectedTask,
  onTaskSelect,
  follow,
  onFollow,
  streamState,
  receivedAt,
  onReport,
  preview,
  runs,
  onRunSelect,
}: {
  stages: NetworkStage[];
  selected: WorkStage | null;
  onSelect: (stage: WorkStage | null) => void;
  active: boolean;
  runKey: string;
  detail: RunDetail | null;
  kind: "audit" | "discovery";
  targetLabel: string;
  onEvidence: () => void;
  selectedTask: string | null;
  onTaskSelect: (id: string) => void;
  follow: boolean;
  onFollow: (value: boolean) => void;
  streamState: string;
  receivedAt: number | null;
  onReport: () => void;
  preview: boolean;
  runs?: RunStar[];
  onRunSelect?: (id: string) => void;
}) {
  const [corePalette, setCorePalette] = useState<CorePalette>("polar");
  // Discovery funnel counts drive the pipeline particles on the neural map.
  const funnel = useMemo(() => {
    const f = detail?.job.payload.funnel as Record<string, unknown> | undefined;
    const count = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
    return f
      ? {
          returned: count(f.returned),
          checked: count(f.checked),
          queued: count(f.queued),
        }
      : null;
  }, [detail]);
  const root = useRef<HTMLDivElement>(null),
    seen = useRef<Set<string> | null>(null);
  const [paused, setPaused] = useState(false),
    [flat, setFlat] = useState(false),
    [small3d, setSmall3d] = useState(false),
    [unavailable, setUnavailable] = useState(false),
    [expanded, setExpanded] = useState(false),
    [modelView, setModelView] = useState(true),
    [modelReset, setModelReset] = useState(0),
    [pulses, setPulses] = useState<
      {
        id: string;
        stage: WorkStage;
        back: boolean;
        label: string;
        taskId?: string;
      }[]
    >([]),
    [now, setNow] = useState(Date.now()),
    [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [mobile, setMobile] = useState(
      () => window.matchMedia("(max-width: 700px)").matches,
    ),
    [foreground, setForeground] = useState(
      document.visibilityState !== "hidden",
    );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)"),
      small = window.matchMedia("(max-width: 700px)");
    const change = () => {
      setReduced(media.matches);
      setMobile(small.matches);
    };
    media.addEventListener("change", change);
    small.addEventListener("change", change);
    const fg = () => setForeground(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", fg);
    const ob = new IntersectionObserver((es) =>
      setVisible(es[0]?.isIntersecting ?? false),
    );
    if (root.current) ob.observe(root.current);
    return () => {
      ob.disconnect();
      media.removeEventListener("change", change);
      small.removeEventListener("change", change);
      document.removeEventListener("visibilitychange", fg);
    };
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const tasks = useMemo(() => researchTasks(detail), [detail]);
  const liveTasks = tasks.filter(
      (t) => isWorkingTask(t.state) && t.attempt === detail?.job.attempts,
    ),
    issues = tasks.filter((t) => isIssueTask(t.state));
  const focus = selectedTask
    ? tasks.find((t) => t.id === selectedTask)
    : selected
      ? tasks.filter((t) => t.stage === selected).at(-1)
      : (liveTasks.at(-1) ?? tasks.at(-1));
  const current = liveTasks.at(-1),
    latest = readWork(detail?.job.payload.work)?.events.at(-1),
    done = detail?.job.status === "completed";
  const coreAppearance: CoreAppearance = {
    state: coreState(tasks, active, detail?.job.status),
    working: active && liveTasks.length > 0,
    palette: corePalette,
    evidence: coreEvidence(detail, tasks, kind),
  };
  const staticView = flat || reduced || (mobile && !small3d) || unavailable,
    motionAllowed = !paused && !reduced && visible && foreground,
    moving = active && motionAllowed;
  const signals =
    motionAllowed &&
    streamState !== "Updates disconnected" &&
    streamState !== "Worker offline";
  useEffect(() => {
    seen.current = null;
    setPulses([]);
  }, [runKey]);
  useEffect(() => {
    const events = readWork(detail?.job.payload.work)?.events ?? [];
    if (!seen.current) {
      seen.current = new Set(events.map((e) => e.id));
      return;
    }
    const knownTasks = new Set(
      events.filter((e) => seen.current!.has(e.id)).map((e) => e.task_id),
    );
    const added = events.filter((e) => !seen.current!.has(e.id));
    events.forEach((e) => seen.current!.add(e.id));
    if (paused || !foreground || !visible || reduced) {
      setPulses([]);
      return;
    }
    const next = added
      .filter((e) => {
        const firstWaiting =
          e.task_state === "waiting" &&
          !!e.task_id &&
          !knownTasks.has(e.task_id);
        if (e.task_id) knownTasks.add(e.task_id);
        return (
          firstWaiting ||
          e.task_state === "starting" ||
          e.task_state === "completed" ||
          e.state === "completed" ||
          (e.state === "started" && e.task_state !== "waiting")
        );
      })
      .slice(-12)
      .map((e) => ({
        id: e.id,
        stage: e.stage,
        back: e.task_state === "completed" || e.state === "completed",
        label: e.message,
        taskId: tasks.find((t) => t.events.some((event) => event.id === e.id))
          ?.id,
      }));
    if (next.length) setPulses(next);
  }, [detail, paused, foreground, visible, reduced]);
  useEffect(() => {
    if (!pulses.length || paused) return;
    const timer = setTimeout(() => setPulses([]), 4000);
    return () => clearTimeout(timer);
  }, [pulses, paused]);
  const choose = (task: ResearchTask) => {
    onSelect(task.stage);
    onTaskSelect(task.id);
    onFollow(false);
  };
  const elapsed = (task: ResearchTask) => {
    const end = task.finishedAt
      ? Date.parse(task.finishedAt)
      : isWorkingTask(task.state) && active && !preview
        ? now
        : Date.parse(task.updatedAt);
    const seconds = Math.max(
      0,
      Math.round((end - Date.parse(task.startedAt)) / 1000),
    );
    return seconds >= 60
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${seconds}s`;
  };
  // Fill the window at once, then upgrade to real browser fullscreen where allowed.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    root.current?.requestFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const sync = () => setExpanded(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!expanded || document.fullscreenElement) return;
    const close = (e: KeyboardEvent) => {
      // The canvas uses Escape to step back along a path; only unhandled presses close.
      if (e.key === "Escape" && !e.defaultPrevented) setExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);
  return (
    <div
      ref={root}
      className={`task-neural ${expanded ? "is-expanded" : ""} ${!motionAllowed ? "motion-paused" : ""} ${staticView ? "is-flat" : ""}`}
    >
      <div className="task-network-toolbar">
        <span>
          <Network size={15} />
          <strong>Scout neural workspace</strong>
          <small>{modelView && !staticView ? "3D" : "2D"}</small>
        </span>
        <div>
          <button onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            <span>{paused ? <Play size={13} /> : <Pause size={13} />}</span>
            {paused ? "Resume animation" : "Pause animation"}
          </button>
          <button onClick={() => onFollow(!follow)} aria-pressed={follow}>
            <Focus size={13} />
            Follow live activity
          </button>
          {(modelView || flat) && (
            <button
              onClick={() => {
                if (staticView) {
                  setSmall3d(true);
                  setFlat(false);
                  setModelView(true);
                } else setFlat(true);
              }}
              disabled={reduced || unavailable}
              title={
                mobile
                  ? "2D is lighter on small screens. You can choose the interactive 3D model."
                  : reduced
                    ? "2D view respects reduced motion"
                    : undefined
              }
            >
              {staticView ? "Use 3D" : "Use 2D"}
            </button>
          )}
          <button
            onClick={() => {
              setModelReset((n) => n + 1);
            }}
            title="Reset view"
            aria-label="Reset view"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={toggleFullscreen}
            aria-expanded={expanded}
            aria-label={
              expanded ? "Collapse research canvas" : "Expand research canvas"
            }
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>
      <div className="task-current" aria-live="polite">
        <span className={`task-state-dot ${active ? "running" : ""}`} />
        <div>
          <small>
            {done
              ? "Completed overview"
              : liveTasks.length > 1
                ? `${liveTasks.length} active tasks`
                : active
                  ? "Current work"
                  : streamState}
          </small>
          <strong>
            {detail?.job.error &&
            ["blocked", "failed", "queued"].includes(detail.job.status)
              ? detail.job.error
              : done
                ? typeof detail.job.payload.result === "string" &&
                  detail.job.payload.result.startsWith("Screened out")
                  ? "Screening finished — store did not qualify"
                  : `${tasks.filter((t) => t.state === "completed").length} recorded tasks completed`
                : (current?.latest.message ??
                  latest?.message ??
                  "Waiting for recorded task activity")}
          </strong>
          <span>
            {done && typeof detail?.job.payload.result === "string"
              ? detail.job.payload.result
              : (current?.url ?? targetLabel)}
            {current
              ? ` · Attempt ${current.attempt} · ${elapsed(current)}`
              : ""}
          </span>
        </div>
        <span className="task-connection">
          {preview ? "Sample playback" : streamState}
          <small>
            {receivedAt
              ? `${active && now - receivedAt > 12000 ? "Updates delayed · " : ""}Received ${pht(new Date(receivedAt).toISOString())} PHT`
              : latest
                ? `Recorded ${pht(latest.at)} PHT`
                : "No updates yet"}
          </small>
        </span>
      </div>
      <div className="task-workspace-body">
        <div className="task-map-column">
          <div className="task-map-legend">
            <span>S.C.O.U.T. → stage → task → result</span>
            <span>
              {liveTasks.length} active · {issues.length} issues
            </span>
          </div>
          <ScoutCoreStatus
            appearance={coreAppearance}
            onPalette={setCorePalette}
            onEvidence={onEvidence}
          />
          <div
            className="research-view-switch"
            aria-label="Research visualization"
          >
            <button
              aria-pressed={modelView && !staticView}
              disabled={staticView}
              onClick={() => setModelView(true)}
            >
              <Network size={13} />
              Neural model
            </button>
            <button
              aria-pressed={!modelView || staticView}
              onClick={() => setModelView(false)}
            >
              <Layers size={13} />
              Task map <span>{tasks.length}</span>
            </button>
          </div>
          {modelView && !staticView ? (
            <CoreBoundary onError={() => setUnavailable(true)}>
              <ResearchModel
                key={runKey}
                stages={stages}
                coreAppearance={coreAppearance}
                tasks={tasks}
                selected={selected ?? focus?.stage ?? null}
                selectedTask={focus?.id ?? null}
                onTaskSelect={(id) => {
                  const task = tasks.find((t) => t.id === id);
                  if (task) choose(task);
                }}
                onSelect={(id) => {
                  const group = tasks.filter((t) => t.stage === id);
                  const task =
                    group.find((t) => isWorkingTask(t.state)) ?? group.at(-1);
                  if (task) choose(task);
                  else {
                    onSelect(id);
                    onFollow(false);
                  }
                }}
                moving={motionAllowed}
                working={active && liveTasks.length > 0}
                paused={paused}
                onResume={() => setPaused(false)}
                onUnavailable={() => setUnavailable(true)}
                signals={pulses}
                resetToken={modelReset}
                funnel={funnel}
                runs={runs}
                runId={runKey}
                onRunSelect={onRunSelect}
                onOpenTaskMap={(stage) => {
                  setModelView(false);
                  onSelect(stage);
                  onFollow(false);
                }}
              />
            </CoreBoundary>
          ) : (
            <TaskFlowMap
              key={runKey}
              stages={stages}
              coreAppearance={coreAppearance}
              tasks={tasks}
              selected={focus?.id ?? null}
              selectedStage={selected}
              active={active}
              done={done}
              moving={motionAllowed}
              reduced={reduced}
              signals={signals ? pulses : []}
              onChoose={choose}
              onStage={(id) => {
                const group = tasks.filter((t) => t.stage === id);
                const task =
                  group.find((t) => isWorkingTask(t.state)) ?? group.at(-1);
                if (task) choose(task);
                else {
                  onSelect(id);
                  onFollow(false);
                }
              }}
              onResume={() => setPaused(false)}
              resetToken={modelReset}
              follow={follow}
              onInteract={() => onFollow(false)}
            />
          )}
          <div className="task-map-footer">
            <span>
              {paused
                ? "Animation paused · task updates continue"
                : reduced
                  ? "Reduced motion · task updates continue"
                  : active
                    ? "Signals follow recorded events"
                    : "Recorded task history"}{" "}
              · {follow ? "Following activity" : "Inspecting history"}
            </span>
          </div>
        </div>
        <aside className="task-inspector" aria-label="Task inspector">
          <div className="task-inspector-heading">
            <Focus size={14} />
            <span>{focus ? "Task inspector" : "Stage inspector"}</span>
          </div>
          {focus ? (
            <>
              <span className={`task-status-tag ${focus.state}`}>
                <StatusIcon task={focus} />
                {taskStatus[focus.state]}
              </span>
              <h4>{focus.name}</h4>
              <p className="task-parent">Scout / {workStages[focus.stage]}</p>
              {focus.url && (
                <a
                  className="task-resource"
                  href={preview ? undefined : focus.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={preview}
                >
                  {focus.url}
                  <ArrowUpRight size={12} />
                </a>
              )}
              {focus.stage === "measure" &&
                typeof focus.facts.sample === "number" && (
                  <div className="task-result-details">
                    <small>
                      {detail?.measurements.some(
                        (m) =>
                          m.strategy === focus.facts.strategy &&
                          m.sample === focus.facts.sample,
                      )
                        ? "Returned measurement"
                        : "No measurement returned yet"}
                    </small>
                    <div className="task-returned-score-grid">
                      {(
                        [
                          ["performance", "Performance"],
                          ["seo", "SEO"],
                        ] as const
                      ).map(([key, label]) => {
                        const measurement = detail?.measurements.find(
                          (m) =>
                            m.strategy === focus.facts.strategy &&
                            m.sample === focus.facts.sample,
                        );
                        if (!measurement) return null;
                        const score = lighthouseScore(measurement.scores[key]);
                        return (
                          <div key={key} className={score.band}>
                            <span>{label}</span>
                            <strong>{score.score ?? "—"}</strong>
                            <small>{score.label}</small>
                          </div>
                        );
                      })}
                    </div>
                    {Object.entries(
                      detail?.measurements.find(
                        (m) =>
                          m.strategy === focus.facts.strategy &&
                          m.sample === focus.facts.sample,
                      )?.scores ?? {},
                    )
                      .filter(([key]) => !["performance", "seo"].includes(key))
                      .map(([key, value]) => (
                        <div key={key}>
                          <span>{key.replaceAll("_", " ")}</span>
                          <strong>
                            {value === null ? "Unavailable" : `${value}/100`}
                          </strong>
                        </div>
                      ))}
                  </div>
                )}
              <dl>
                <div>
                  <dt>Started · PHT</dt>
                  <dd>{pht(focus.startedAt)}</dd>
                </div>
                <div>
                  <dt>Elapsed</dt>
                  <dd>{elapsed(focus)}</dd>
                </div>
                <div>
                  <dt>Attempt</dt>
                  <dd>{focus.attempt}</dd>
                </div>
                {typeof focus.facts.sample === "number" && (
                  <div>
                    <dt>Sample</dt>
                    <dd>{focus.facts.sample} of 3</dd>
                  </div>
                )}
              </dl>
              <div className="task-latest">
                <small>Latest recorded update</small>
                <p>{focus.latest.message}</p>
              </div>
              {isIssueTask(focus.state) && detail?.job.error && (
                <p className="task-error">{detail.job.error}</p>
              )}
              <div className="task-result-details">
                <small>
                  {focus.state === "completed"
                    ? "Result received"
                    : "Available evidence"}
                </small>
                <p>{resultSummary(focus)}</p>
                {Object.entries(focus.facts)
                  .filter(
                    ([key]) =>
                      ![
                        "query",
                        "tested_at",
                        "performance",
                        "seo",
                        "strategy",
                        "sample",
                        "total",
                      ].includes(key),
                  )
                  .map(([key, val]) => (
                    <div key={key}>
                      <span>{key.replaceAll("_", " ")}</span>
                      <strong>
                        {val === null
                          ? "Unavailable"
                          : typeof val === "boolean"
                            ? val
                              ? "Yes"
                              : "No"
                            : String(val)}
                      </strong>
                    </div>
                  ))}
              </div>
              {!!detail?.findings.some((f) => f.url === focus.url) && (
                <div className="task-related">
                  <small>Findings on this page</small>
                  {detail.findings
                    .filter((f) => f.url === focus.url)
                    .map((f, i) => (
                      <p key={`${f.title}-${i}`}>
                        <strong>{f.title}</strong>
                        <br />
                        {f.category} · {f.severity} priority
                      </p>
                    ))}
                </div>
              )}
              <div className="task-related">
                <small>{focus.events.length} related updates</small>
                {focus.events.slice(-8).map((e) => (
                  <p key={e.id}>
                    <time>{pht(e.at)}</time>
                    {e.message}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <>
              <h4>{selected ? workStages[selected] : "Ready for Scout"}</h4>
              <p>
                No individual task activity has been recorded here yet. New runs
                include task details as work happens.
              </p>
            </>
          )}
          <button className="task-evidence-link" onClick={onEvidence}>
            View saved evidence
            <ArrowUpRight size={13} />
          </button>
        </aside>
      </div>
      {pulses.some((p) => p.back) && !paused && (
        <div className="task-arrival" role="status">
          <Check size={14} />
          {pulses.filter((p) => p.back).at(-1)?.label}
        </div>
      )}
      {done && (
        <div className="task-completion">
          <Check size={17} />
          <div>
            <strong>Research finished</strong>
            <span>
              {tasks.filter((t) => t.state === "completed").length} completed
              tasks · {detail?.measurements.length ?? 0} measurements ·{" "}
              {detail?.findings.length ?? 0} findings shown
            </span>
          </div>
          {detail?.report_id && (
            <button onClick={onReport} disabled={preview}>
              <FileText size={14} />
              {preview ? "Sample report" : "Open finished report"}
              <ArrowUpRight size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
