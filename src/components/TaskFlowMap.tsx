import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Search,
  ShieldCheck,
  BarChart3,
  Layers,
  FileText,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  AlertCircle,
  ChevronDown,
  Play,
  Pause,
  X,
  Route,
} from "lucide-react";
import { workStages, type WorkStage } from "../../shared/job-activity";
import {
  isIssueTask,
  isWorkingTask,
  resultSummary,
  taskStatus,
  type ResearchTask,
} from "../../shared/research-tasks";
import type { NetworkStage } from "./research-network-model";
import type { ActivitySignal } from "./neural-task-graph";
import {
  filterFlowTasks,
  visibleFlowTasks,
  flowConnection,
  type FlowFilter,
} from "./task-flow-model";
import "../task-flow.css";
import { lighthouseScore } from "../../shared/lighthouse-score";
import ScoutCoreGlyph from "./ScoutCoreGlyph";
import type { CoreAppearance } from "./scout-core-model";
const icons = {
  prepare: Layers,
  search: Search,
  verify: ShieldCheck,
  queue: ArrowRight,
  measure: BarChart3,
  inspect: Layers,
  report: FileText,
};
type Connection = { stage: WorkStage; path: string };
function FlowStatus({ state }: { state: ResearchTask["state"] }) {
  return state === "completed" ? (
    <Check size={14} />
  ) : isIssueTask(state) ? (
    <AlertCircle size={14} />
  ) : state === "waiting" || state === "queued" ? (
    <Clock3 size={14} />
  ) : (
    <i />
  );
}
function FlowResult({ task }: { task: ResearchTask }) {
  const score = lighthouseScore(task.facts.performance);
  if (task.state === "completed" && score.score !== null)
    return (
      <>
        <strong>
          {score.score}
          <small>/100</small>
        </strong>
        <span>Performance</span>
      </>
    );
  if (
    task.state === "completed" &&
    typeof task.facts.emails === "number" &&
    task.facts.emails > 0
  )
    return (
      <>
        <strong>{task.facts.emails}</strong>
        <span>Public emails</span>
      </>
    );
  if (task.state === "completed" && typeof task.facts.findings === "number")
    return (
      <>
        <strong>{task.facts.findings}</strong>
        <span>Findings</span>
      </>
    );
  return (
    <>
      <ArrowUpRight size={16} />
      <span>{task.state === "completed" ? "Result" : "Details"}</span>
    </>
  );
}
function Packet({
  path,
  back = false,
  preview = false,
  delay = 0,
}: {
  path: string;
  back?: boolean;
  preview?: boolean;
  delay?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flow-packet ${preview ? "preview" : ""} ${back ? "returning" : ""}`}
      style={
        {
          offsetPath: `path("${path}")`,
          animationDelay: `${delay}s`,
        } as CSSProperties
      }
    />
  );
}
function resource(task: ResearchTask) {
  if (!task.url) return null;
  try {
    const url = new URL(task.url);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}
export default function TaskFlowMap({
  stages,
  coreAppearance,
  tasks,
  selected,
  selectedStage,
  active,
  done,
  moving,
  reduced,
  signals,
  onChoose,
  onStage,
  onResume,
  resetToken,
  follow,
  onInteract,
}: {
  stages: NetworkStage[];
  coreAppearance: CoreAppearance;
  tasks: ResearchTask[];
  selected: string | null;
  selectedStage: WorkStage | null;
  active: boolean;
  done: boolean;
  moving: boolean;
  reduced: boolean;
  signals: ActivitySignal[];
  onChoose: (task: ResearchTask) => void;
  onStage: (stage: WorkStage) => void;
  onResume: () => void;
  resetToken: number;
  follow: boolean;
  onInteract: () => void;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState<FlowFilter>("all"),
    [limits, setLimits] = useState<Partial<Record<WorkStage, number>>>({}),
    [collapsed, setCollapsed] = useState<WorkStage[]>([]),
    [exploring, setExploring] = useState(false),
    [trace, setTrace] = useState<{ id: string; stage: WorkStage } | null>(null),
    [connections, setConnections] = useState<Connection[]>([]);
  const graph = useRef<HTMLDivElement>(null),
    traceCount = useRef(0);
  useEffect(() => {
    setQuery("");
    setFilter("all");
    setLimits({});
    setCollapsed([]);
    setExploring(false);
    setTrace(null);
  }, [resetToken]);
  useEffect(() => {
    if (!trace) return;
    const timer = window.setTimeout(() => setTrace(null), 2400);
    return () => window.clearTimeout(timer);
  }, [trace]);
  const filtered = useMemo(
    () => filterFlowTasks(tasks, query, filter),
    [tasks, query, filter],
  );
  const groups = useMemo(
    () =>
      stages.map((stage) => {
        const all = tasks.filter((t) => t.stage === stage.id),
          matching = filtered.filter((t) => t.stage === stage.id);
        return {
          stage,
          all,
          matching,
          visible: visibleFlowTasks(
            matching,
            limits[stage.id] ?? 2,
            selected,
            active && follow,
          ),
        };
      }),
    [stages, tasks, filtered, limits, selected, active, follow],
  );
  const selectedTask = tasks.find((t) => t.id === selected),
    selectedVisible = filtered.some((t) => t.id === selected),
    completed = tasks.filter((t) => t.state === "completed").length,
    issues = tasks.filter((t) => isIssueTask(t.state)).length,
    running = tasks.filter((t) => isWorkingTask(t.state)).length,
    previewStage = selectedTask?.stage ?? selectedStage ?? stages[0]?.id;
  const layoutKey = groups
    .map((g) => `${g.stage.id}:${g.visible.map((t) => t.id).join(",")}`)
    .join("|");
  useLayoutEffect(() => {
    const root = graph.current;
    if (!root) return;
    const measure = () => {
      const frame = root.getBoundingClientRect(),
        core = root
          .querySelector<HTMLElement>('[data-flow-anchor="core"]')
          ?.getBoundingClientRect();
      if (!core) return;
      const next = stages.flatMap((stage) => {
        const target = root
          .querySelector<HTMLElement>(`[data-flow-anchor="${stage.id}"]`)
          ?.getBoundingClientRect();
        if (!target) return [];
        return [
          {
            stage: stage.id,
            path: flowConnection(
              {
                x: core.left + core.width / 2 - frame.left,
                y: core.bottom - frame.top,
              },
              {
                x: target.left + target.width / 2 - frame.left,
                y: target.top + target.height / 2 - frame.top,
              },
              frame.width < 520 ? 8 : undefined,
            ),
          },
        ];
      });
      setConnections((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll(".flow-stage").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [layoutKey, collapsed, stages]);
  useEffect(() => {
    if (!active || !follow || !selected || !graph.current) return;
    const row = graph.current.querySelector<HTMLElement>(
      `[data-task-id="${CSS.escape(selected)}"]`,
    );
    const viewport = graph.current.parentElement;
    if (!row || !viewport) return;
    const box = row.getBoundingClientRect(),
      frame = viewport.getBoundingClientRect();
    if (box.bottom > frame.bottom)
      viewport.scrollTop += box.bottom - frame.bottom + 12;
    else if (box.top < frame.top)
      viewport.scrollTop -= frame.top - box.top + 12;
  }, [active, follow, selected, layoutKey]);
  const choose = (task: ResearchTask) => {
    onChoose(task);
    if (!reduced)
      setTrace({ id: `${task.id}:${++traceCount.current}`, stage: task.stage });
  };
  const animated = moving && !reduced;
  const previewing = animated && (exploring || trace !== null);
  return (
    <div
      className={`task-flow-map ${animated ? "can-animate" : ""} ${previewing ? "is-exploring" : ""}`}
      onPointerDown={() => {
        if (follow) onInteract();
      }}
      onKeyDown={() => {
        if (follow) onInteract();
      }}
      onWheel={() => {
        if (follow) onInteract();
      }}
      onTouchMove={() => {
        if (follow) onInteract();
      }}
    >
      <div className="flow-toolbar">
        <div>
          <Route size={16} />
          <strong>Research flow</strong>
          <span>{tasks.length} tasks</span>
        </div>
        <button
          aria-pressed={exploring}
          disabled={reduced || !filtered.length}
          onClick={() => {
            onResume();
            setExploring((v) => !v);
          }}
        >
          {exploring ? <Pause size={14} /> : <Play size={14} />}
          {exploring ? "Stop flow preview" : "Preview flow"}
        </button>
      </div>
      <div className="flow-find">
        <label>
          <Search size={14} />
          <span className="sr-only">Find a task</span>
          <input
            aria-label="Find a task"
            placeholder="Find task or website…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear task search" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </label>
        <div role="group" aria-label="Filter task map">
          {(
            [
              ["all", "All", tasks.length],
              ["running", "Running", running],
              ["issues", "Needs attention", issues],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flow-viewport">
        <div ref={graph} className="flow-graph">
          <svg className="flow-connections" aria-hidden="true">
            {connections.map((c) => (
              <path
                key={c.stage}
                d={c.path}
                className={`${selectedTask?.stage === c.stage || selectedStage === c.stage ? "selected" : ""} ${stages.find((s) => s.id === c.stage)?.state ?? ""}`}
              />
            ))}
          </svg>
          <div
            className={`flow-core ${animated && active && running > 0 ? "working" : animated && exploring ? "preview-motion" : ""}`}
          >
            <div className="flow-core-mark" aria-hidden="true">
              <ScoutCoreGlyph
                appearance={coreAppearance}
                moving={moving && !reduced}
                signals={signals}
              />
            </div>
            <i
              className="flow-core-port"
              data-flow-anchor="core"
              aria-hidden="true"
            />
            <strong>
              scout<span>Research engine</span>
            </strong>
            <div>
              <span>
                {active
                  ? `${running} active · ${completed} completed`
                  : done
                    ? `${completed} tasks completed`
                    : tasks.length
                      ? "Recorded task history"
                      : "Ready for research"}
              </span>
              <small>
                {previewing
                  ? "Visual preview · starts no job"
                  : active
                    ? "Signals follow worker updates"
                    : "Select a task to trace its evidence"}
              </small>
            </div>
          </div>
          <div className="flow-stage-grid">
            {groups.map(({ stage, all, matching, visible }) => {
              const Icon = icons[stage.id],
                countDone = all.filter(
                  (t) => t.state === "completed" || t.state === "skipped",
                ).length,
                countIssue = all.filter((t) => isIssueTask(t.state)).length,
                isCollapsed =
                  collapsed.includes(stage.id) &&
                  !(
                    active &&
                    follow &&
                    all.some((t) => isWorkingTask(t.state))
                  );
              return (
                <section
                  className={`flow-stage ${stage.state} ${selectedTask?.stage === stage.id || selectedStage === stage.id ? "selected" : ""}`}
                  key={stage.id}
                  aria-label={`${stage.label} tasks`}
                >
                  <i
                    className="flow-stage-port"
                    data-flow-anchor={stage.id}
                    aria-hidden="true"
                  />
                  <header>
                    <button
                      onClick={() => onStage(stage.id)}
                      aria-pressed={selectedStage === stage.id}
                    >
                      <span className="flow-stage-icon">
                        <Icon size={16} />
                      </span>
                      <span>
                        <strong>{stage.label}</strong>
                        <small>
                          {all.length
                            ? `${countDone} of ${all.length} finished${countIssue ? ` · ${countIssue} need attention` : ""}`
                            : done
                              ? "No recorded tasks"
                              : "Waiting for this stage"}
                        </small>
                      </span>
                    </button>
                    <button
                      aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${stage.label}`}
                      aria-expanded={!isCollapsed}
                      onClick={() =>
                        setCollapsed((c) =>
                          c.includes(stage.id)
                            ? c.filter((s) => s !== stage.id)
                            : [...c, stage.id],
                        )
                      }
                    >
                      <ChevronDown size={16} />
                    </button>
                  </header>
                  {all.length > 0 && (
                    <div className="flow-stage-progress" aria-hidden="true">
                      <i
                        style={{ width: `${(countDone / all.length) * 100}%` }}
                      />
                      <b
                        style={{ width: `${(countIssue / all.length) * 100}%` }}
                      />
                    </div>
                  )}
                  {!isCollapsed && (
                    <div className="flow-task-list">
                      {visible.map((task) => (
                        <div
                          className={`flow-task ${task.state} ${selected === task.id ? "selected" : ""}`}
                          key={task.id}
                          data-task-id={task.id}
                        >
                          <svg
                            className="flow-task-twig"
                            viewBox="0 0 18 64"
                            preserveAspectRatio="none"
                            aria-hidden="true"
                          >
                            <path d="M1 0 V64 M1 28 Q1 34 17 34" />
                          </svg>
                          <button
                            className="flow-task-main"
                            aria-pressed={selected === task.id}
                            aria-label={`${task.name}: ${taskStatus[task.state]}`}
                            onClick={() => choose(task)}
                          >
                            <span className="flow-task-state">
                              <FlowStatus state={task.state} />
                            </span>
                            <span>
                              <strong>{task.name}</strong>
                              <small>
                                {taskStatus[task.state]}
                                {task.state === "retrying"
                                  ? ` · attempt ${task.attempt}`
                                  : ""}
                              </small>
                              {resource(task) && (
                                <span
                                  className="flow-task-resource"
                                  title={resource(task) ?? undefined}
                                >
                                  {resource(task)}
                                </span>
                              )}
                            </span>
                          </button>
                          <button
                            className={`flow-task-result ${lighthouseScore(task.facts.performance).band}`}
                            aria-label={`Inspect ${task.name} result`}
                            onClick={() => choose(task)}
                            title={resultSummary(task)}
                          >
                            <FlowResult task={task} />
                          </button>
                          {animated &&
                            signals
                              .filter((s) => s.taskId === task.id)
                              .map((s) => (
                                <i
                                  key={s.id}
                                  className={`flow-task-arrival ${s.back ? "returned" : ""}`}
                                  aria-hidden="true"
                                />
                              ))}
                          {previewing && selected === task.id && (
                            <i
                              key={trace?.id ?? "explore"}
                              className="flow-task-arrival preview"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                      ))}
                      {!matching.length && (
                        <p className="flow-empty">
                          {query || filter !== "all"
                            ? "No matching tasks in this stage."
                            : done
                              ? "No task events were recorded."
                              : "Tasks will appear as Scout reaches this stage."}
                        </p>
                      )}
                      {matching.length > visible.length && (
                        <button
                          className="flow-show-more"
                          onClick={() =>
                            setLimits((v) => ({
                              ...v,
                              [stage.id]: (v[stage.id] ?? 2) + 4,
                            }))
                          }
                        >
                          Show {Math.min(4, matching.length - visible.length)}{" "}
                          more{" "}
                          <span>
                            {visible.length} of {matching.length} shown
                          </span>
                          <ChevronDown size={14} />
                        </button>
                      )}
                      {(limits[stage.id] ?? 2) > 2 && (
                        <button
                          className="flow-show-fewer"
                          onClick={() =>
                            setLimits((v) => ({ ...v, [stage.id]: 2 }))
                          }
                        >
                          Show fewer tasks
                          <ChevronDown size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          {animated &&
            connections.flatMap((c) =>
              signals
                .filter((s) => s.stage === c.stage)
                .map((s, i) => (
                  <Packet
                    key={s.id}
                    path={c.path}
                    back={s.back}
                    delay={i * 0.08}
                  />
                )),
            )}
          {previewing &&
            connections
              .filter((c) => c.stage === (trace?.stage ?? previewStage))
              .map((c) => (
                <Packet
                  key={`${c.stage}:${trace?.id ?? "explore"}`}
                  path={c.path}
                  preview
                />
              ))}
        </div>
      </div>
      <div className="flow-selection" aria-live="polite">
        <Route size={14} />
        <div>
          <strong>
            {selectedTask
              ? `S.C.O.U.T. → ${stages.find((x) => x.id === selectedTask.stage)?.label ?? workStages[selectedTask.stage]} → ${selectedTask.name}`
              : "S.C.O.U.T. → stage → task → result"}
          </strong>
          <span>
            {selectedTask
              ? resultSummary(selectedTask)
              : "Select any task or result to open its recorded evidence."}
          </span>
          {selectedTask && !selectedVisible && (
            <small>
              Selected task is outside the current filter.{" "}
              <button
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Clear filters
              </button>
            </small>
          )}
        </div>
      </div>
      <div className="flow-legend">
        <span>
          <i className="complete" />
          Completed
        </span>
        <span>
          <i className="working" />
          Active or waiting
        </span>
        <span>
          <i className="issue" />
          Needs attention
        </span>
        <span>
          <i className="preview" />
          Visual preview
        </span>
      </div>
    </div>
  );
}
