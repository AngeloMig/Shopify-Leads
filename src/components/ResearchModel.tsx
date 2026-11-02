import {
  Suspense,
  lazy,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  Network,
  Pause,
  Play,
  RotateCcw,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  Focus,
  Zap,
  Check,
  AlertCircle,
  Clock3,
  Orbit,
  Eye,
  EyeOff,
  Maximize,
  Minimize,
  Sparkles,
  Brain,
} from "lucide-react";
import { workStages, type WorkStage } from "../../shared/job-activity";
import {
  isWorkingTask,
  isIssueTask,
  resultSummary,
  taskStatus,
  type ResearchTask,
} from "../../shared/research-tasks";
import {
  neuralDensities,
  type NetworkStage,
  type RunStar,
} from "./research-network-model";
import RunStarMap from "./RunStarMap";
import type { CameraCommand, ProjectedNode } from "./NeuralScene";
import {
  buildTaskGraph,
  coreAnchorId,
  linkChipId,
  placeLabels,
  type ActivitySignal,
  type SemanticNode,
  type NeuralView,
} from "./neural-task-graph";
import type { CoreAppearance } from "./scout-core-model";
const NeuralScene = lazy(() => import("./NeuralScene"));
const elapsed = (from: string, to: string) => {
  const seconds = Math.max(
    0,
    Math.round((Date.parse(to) - Date.parse(from)) / 1000),
  );
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
};
export default function ResearchModel({
  stages,
  coreAppearance,
  tasks,
  selected,
  selectedTask,
  onSelect,
  onTaskSelect,
  moving,
  working,
  paused,
  onResume,
  onUnavailable,
  signals,
  resetToken,
  onOpenTaskMap,
  funnel = null,
  runs = [],
  runId = "",
  onRunSelect,
}: {
  stages: NetworkStage[];
  coreAppearance: CoreAppearance;
  tasks: ResearchTask[];
  selected: WorkStage | null;
  selectedTask: string | null;
  onSelect: (id: WorkStage) => void;
  onTaskSelect: (id: string) => void;
  moving: boolean;
  working: boolean;
  paused: boolean;
  onResume: () => void;
  onUnavailable: () => void;
  signals: ActivitySignal[];
  resetToken: number;
  onOpenTaskMap: (stage: WorkStage) => void;
  funnel?: { returned: number; checked: number; queued: number } | null;
  /** Past runs for the star map, newest first. */
  runs?: RunStar[];
  runId?: string;
  onRunSelect?: (id: string) => void;
}) {
  const [neuronCount, setNeuronCount] = useState<number>(2000);
  const [hovered, setHovered] = useState<string | null>(null),
    [exploring, setExploring] = useState(false),
    [pulse, setPulse] = useState(0),
    [tracing, setTracing] = useState(false),
    [orbiting, setOrbiting] = useState(true),
    [tissue, setTissue] = useState(true),
    [camera, setCamera] = useState<CameraCommand>({ action: "reset", id: 0 }),
    [view, setView] = useState<NeuralView>("overview"),
    [expanded, setExpanded] = useState<WorkStage[]>([]),
    [spread, setSpread] = useState<WorkStage | null>(null),
    [previewId, setPreviewId] = useState<string | null>(null);
  const preview = useRef<HTMLDivElement>(null),
    previewRef = useRef<string | null>(null),
    nodeDouble = useRef(false);
  previewRef.current = previewId;
  const labelsRoot = useRef<HTMLDivElement>(null),
    leaders = useRef<SVGSVGElement>(null),
    chip = useRef<HTMLDivElement>(null),
    canvasRoot = useRef<HTMLDivElement>(null);
  // Map-only fullscreen: just the 3D model, no labels, panels or app chrome.
  const [immersive, setImmersive] = useState(false);
  const toggleImmersive = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (immersive) {
      setImmersive(false);
      return;
    }
    setImmersive(true);
    canvasRoot.current?.requestFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const sync = () =>
      setImmersive(document.fullscreenElement === canvasRoot.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!immersive || document.fullscreenElement) return;
    // Window-filling fallback: Escape leaves before the map can use it to step back.
    const close = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setImmersive(false);
    };
    window.addEventListener("keydown", close, true);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", close, true);
      document.documentElement.style.overflow = overflow;
    };
  }, [immersive]);
  useEffect(() => {
    if (!tracing) return;
    const timer = window.setTimeout(() => setTracing(false), 2800);
    return () => window.clearTimeout(timer);
  }, [tracing, pulse]);
  useEffect(() => {
    setTracing(false);
    setExploring(false);
    setOrbiting(true);
    setCamera((c) => ({ action: "reset", id: c.id + 1 }));
    setView("overview");
    setExpanded([]);
    setSpread(null);
  }, [resetToken]);
  // Only a stage-focus view keeps a stage fanned out.
  const spreadStage = view === "stage" ? spread : null;
  const graph = useMemo(
    () =>
      buildTaskGraph(stages, tasks, {
        view,
        stage: selected,
        taskId: selectedTask,
        expanded,
        signals,
        spread: spreadStage,
      }),
    [
      stages,
      tasks,
      view,
      selected,
      selectedTask,
      expanded,
      signals,
      spreadStage,
    ],
  );
  const hoverNode = graph.nodes.find((n) => n.id === hovered),
    hoverEdge = graph.edges.find((e) => e.id === hovered),
    // A hovered or keyboard-focused stage/core describes itself, not the selected task.
    hoverTask = tasks.find(
      (t) =>
        t.id ===
        (hovered ? (hoverNode?.taskId ?? hoverEdge?.taskId) : selectedTask),
    );
  // Hover preview: resting on a task for half a second shows its latest update.
  useEffect(() => {
    if (hoverNode?.kind !== "task") {
      setPreviewId(null);
      return;
    }
    const timer = window.setTimeout(() => setPreviewId(hoverNode.id), 500);
    return () => window.clearTimeout(timer);
  }, [hoverNode?.id, hoverNode?.kind]);
  const previewNode = graph.nodes.find((n) => n.id === previewId),
    previewTask = tasks.find((t) => t.id === previewNode?.taskId);
  const labels = graph.nodes.filter(
    (n) =>
      n.id !== previewId &&
      (n.kind === "core" ||
        n.kind === "stage" ||
        (n.kind === "cluster" && view !== "overview") ||
        (!!selectedTask && n.taskId === selectedTask) ||
        n.id === hovered ||
        (!!hoverEdge?.taskId && n.taskId === hoverEdge.taskId) ||
        (n.kind === "task" &&
          (isWorkingTask(n.state as ResearchTask["state"]) ||
            isIssueTask(n.state as ResearchTask["state"])))),
  );
  const labelRef = useRef(labels);
  labelRef.current = labels;
  const taskRef = useRef(selectedTask);
  taskRef.current = selectedTask;
  const onProject = useCallback(
    (positions: ProjectedNode[], width: number, height: number) => {
      const candidates = labelRef.current
        .map((n) => {
          const p = positions.find((p) => p.id === n.id);
          if (!p) return null;
          const w =
              n.kind === "core"
                ? 120
                : n.kind === "cluster"
                  ? 138
                  : n.kind === "stage"
                    ? 176
                    : 156,
            h =
              labelsRoot.current?.querySelector<HTMLElement>(
                `[data-node-id="${CSS.escape(n.id)}"]`,
              )?.offsetHeight ||
              (n.kind === "core"
                ? 30
                : n.kind === "stage"
                  ? 54
                  : n.kind === "cluster"
                    ? 38
                    : 66);
          return {
            id: n.id,
            x:
              n.kind === "core"
                ? p.x - w / 2
                : p.x < width / 2
                  ? p.x - w - 18
                  : p.x + 18,
            y:
              n.kind === "core"
                ? (positions.find((a) => a.id === coreAnchorId)?.y ??
                    p.y + 42) + 4
                : p.y - h / 2,
            width: w,
            height: h,
            priority:
              n.kind === "core"
                ? 1200
                : n.kind === "stage"
                  ? 1100
                  : n.taskId === taskRef.current
                    ? 1000
                    : isWorkingTask(n.state as ResearchTask["state"])
                      ? 900
                      : 700,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);
      for (const item of placeLabels(candidates, width, height)) {
        const label = labelsRoot.current?.querySelector<HTMLElement>(
            `[data-node-id="${CSS.escape(item.id)}"]`,
          ),
          line = leaders.current?.querySelector<SVGPathElement>(
            `[data-node-id="${CSS.escape(item.id)}"]`,
          ),
          p = positions.find((n) => n.id === item.id);
        if (label) {
          label.style.transform = `translate(${item.x}px,${item.y}px)`;
          label.style.visibility = item.visible ? "visible" : "hidden";
          label.style.width = `${item.width}px`;
        }
        if (line && p) {
          const x = Math.max(item.x, Math.min(item.x + item.width, p.x)),
            y = Math.max(item.y, Math.min(item.y + item.height, p.y));
          line.setAttribute("d", `M${p.x} ${p.y} Q${p.x} ${y} ${x} ${y}`);
          line.style.opacity = item.visible && item.id !== "scout" ? ".5" : "0";
        }
      }
      const mid = positions.find((p) => p.id === linkChipId);
      if (chip.current) {
        chip.current.style.visibility = mid ? "visible" : "hidden";
        if (mid)
          chip.current.style.transform = `translate(${Math.max(80, Math.min(width - 80, mid.x))}px,${mid.y}px)`;
      }
      const at = positions.find((p) => p.id === previewRef.current);
      if (preview.current && at) {
        const w = preview.current.offsetWidth,
          h = preview.current.offsetHeight,
          x = at.x < width / 2 ? at.x - w - 22 : at.x + 22;
        preview.current.style.transform = `translate(${Math.max(8, Math.min(width - w - 8, x))}px,${Math.max(8, Math.min(height - h - 8, at.y - h / 2))}px)`;
        preview.current.style.visibility = "visible";
      }
    },
    [],
  );
  // Double-click a stage to zoom in and fan its tasks out; double-click empty
  // space to zoom back out.
  const zoomStage = (stage: WorkStage) => {
    nodeDouble.current = true;
    onSelect(stage);
    setExpanded((e) => (e.includes(stage) ? e : [...e, stage]));
    setSpread(stage);
    setView("stage");
  };
  const trace = () => {
    if (paused) onResume();
    setTracing(true);
    setPulse((n) => n + 1);
  };
  const choose = (node: SemanticNode) => {
    if (moving && !working) trace();
    if (node.kind === "core") {
      setView("overview");
      return;
    }
    if (node.kind === "cluster") {
      if (expanded.includes(node.stage!)) {
        onOpenTaskMap(node.stage!);
        return;
      }
      setExpanded((e) => (e.includes(node.stage!) ? e : [...e, node.stage!]));
      setView("stage");
      onSelect(node.stage!);
      return;
    }
    if (node.taskId) {
      onTaskSelect(node.taskId);
      setView("task");
    } else if (node.stage) {
      onSelect(node.stage);
      setView("stage");
    }
  };
  // Run history: zooming out past the furthest step dissolves the brain into a
  // star map of past runs.
  const [starMap, setStarMap] = useState(false),
    zoomLevel = useRef(0);
  const command = (action: CameraCommand["action"]) => {
    if (action === "out") {
      if (zoomLevel.current <= -2 && runs.length) {
        setStarMap(true);
        return;
      }
      zoomLevel.current = Math.max(-2, zoomLevel.current - 1);
    } else if (action === "in")
      zoomLevel.current = Math.min(4, zoomLevel.current + 1);
    else if (action === "reset") zoomLevel.current = 0;
    setCamera((c) => ({ action, id: c.id + 1 }));
  };
  useEffect(() => {
    if (!starMap) return;
    const close = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setStarMap(false);
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [starMap]);
  const animate = moving;
  // Keyboard: walk core → stage → task → result along the links.
  const childrenOf = (id: string) =>
    graph.edges.filter((e) => e.source === id).map((e) => e.target);
  const parentOf = (id: string) =>
    graph.edges.find((e) => e.target === id)?.source;
  const walk = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const current = graph.nodes.some((n) => n.id === hovered) ? hovered : null;
    let next: string | null | undefined;
    if (e.key === "ArrowRight")
      next = current ? (childrenOf(current)[0] ?? current) : "scout";
    else if (e.key === "ArrowLeft")
      next = current ? (parentOf(current) ?? current) : "scout";
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!current) next = "scout";
      else {
        const parent = parentOf(current),
          siblings = parent ? childrenOf(parent) : [current],
          step = e.key === "ArrowDown" ? 1 : -1;
        next =
          siblings[
            (siblings.indexOf(current) + step + siblings.length) %
              siblings.length
          ];
      }
    } else if (e.key === "Enter" || e.key === " ") {
      const node = graph.nodes.find((n) => n.id === current);
      if (!node) return;
      choose(node);
    } else if (e.key === "Escape")
      next = current ? (parentOf(current) ?? null) : null;
    else return;
    e.preventDefault();
    if (next !== undefined) setHovered(next);
  };
  const chipTarget = hoverEdge
      ? graph.nodes.find((n) => n.id === hoverEdge.target)
      : undefined,
    chipTask = hoverEdge?.taskId
      ? tasks.find((t) => t.id === hoverEdge.taskId)
      : undefined,
    chipStage = stages.find((s) => s.id === hoverEdge?.stage);
  const path = hoverEdge
    ? `${graph.nodes.find((n) => n.id === hoverEdge.source)?.label} → ${graph.nodes.find((n) => n.id === hoverEdge.target)?.label}`
    : hoverTask
      ? `S.C.O.U.T. → ${workStages[hoverTask.stage]} → ${hoverTask.name}`
      : (hoverNode?.label ?? "S.C.O.U.T. → stage → task → result");
  return (
    <div
      className={`research-model semantic-research-model ${paused ? "is-paused" : ""} ${animate ? "is-animating" : ""}`}
    >
      <div className="research-model-top">
        <span>
          <i className={working ? "on" : ""} />
          {working
            ? "Live task signals"
            : tracing
              ? "Path preview · recorded evidence"
              : exploring || orbiting
                ? "Model exploration · starts no job"
                : "Recorded overview · select a path"}
        </span>
        <span>{tasks.length} recorded tasks</span>
        <button
          className="neural-play-control"
          aria-pressed={exploring}
          disabled={working}
          onClick={() => {
            if (paused) onResume();
            setExploring((v) => !v);
          }}
        >
          {exploring ? <Pause size={13} /> : <Play size={13} />}
          {exploring ? "Stop motion" : "Explore motion"}
        </button>
      </div>
      <div className="semantic-view-controls" aria-label="Network detail level">
        {(["overview", "stage", "task"] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={view === mode}
            disabled={
              (mode === "stage" && !selected) ||
              (mode === "task" && !selectedTask)
            }
            onClick={() => setView(mode)}
          >
            {mode === "overview"
              ? "Overview"
              : mode === "stage"
                ? "Stage focus"
                : "Task focus"}
          </button>
        ))}
        <label>
          <span className="sr-only">Inspect a recorded task</span>
          <select
            aria-label="Inspect a recorded task"
            value={selectedTask ?? ""}
            onChange={(e) => {
              if (e.target.value) {
                onTaskSelect(e.target.value);
                setView("task");
                if (moving && !working) trace();
              }
            }}
          >
            <option value="">Choose a task…</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {workStages[t.stage]} · {t.name} · {taskStatus[t.state]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        ref={canvasRoot}
        className={`research-model-canvas semantic-canvas ${immersive ? "is-immersive" : ""} ${starMap ? "is-starmap" : ""}`}
        aria-label="Interactive task-linked 3D neural model. Arrow keys walk the links, Enter opens, Escape goes back."
        role="application"
        tabIndex={0}
        onKeyDown={walk}
        onDoubleClick={() => {
          if (nodeDouble.current) {
            nodeDouble.current = false;
            return;
          }
          if (view !== "overview" || spread) {
            setSpread(null);
            setView("overview");
          }
        }}
      >
        <Suspense
          fallback={
            <div className="research-model-loading">
              <Network size={32} />
              <span>Loading the task-linked neural model…</span>
            </div>
          }
        >
          <NeuralScene
            graph={graph}
            coreAppearance={coreAppearance}
            neuronCount={neuronCount}
            selectedTask={selectedTask}
            selectedStage={selected}
            hovered={hovered}
            view={view}
            moving={animate}
            working={working}
            exploring={exploring && !working}
            tracing={tracing}
            orbiting={orbiting}
            tissue={tissue}
            activitySignals={signals}
            onUnavailable={onUnavailable}
            fallback={<Network size={46} />}
            cameraCommand={camera}
            pulseToken={pulse}
            onPulse={trace}
            onPick={choose}
            onHover={setHovered}
            onProject={onProject}
            onZoomStage={zoomStage}
            spread={spreadStage}
            funnel={funnel}
          />
        </Suspense>
        {starMap && (
          <RunStarMap
            runs={runs}
            currentId={runId}
            onPick={(id) => {
              setStarMap(false);
              onRunSelect?.(id);
            }}
            onClose={() => setStarMap(false)}
          />
        )}
        <button
          className="neural-immersive-toggle"
          onClick={toggleImmersive}
          aria-pressed={immersive}
          aria-label={
            immersive ? "Exit fullscreen map" : "Show the neural map fullscreen"
          }
          title={immersive ? "Exit fullscreen (Esc)" : "Fullscreen map"}
        >
          {immersive ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>
        {runs.length > 0 && (
          <button
            className="neural-starmap-toggle"
            onClick={() => setStarMap((v) => !v)}
            aria-pressed={starMap}
            aria-label={
              starMap ? "Back to the brain" : "Show run history as stars"
            }
            title={starMap ? "Back to the brain (Esc)" : "Run history"}
          >
            {starMap ? <Brain size={15} /> : <Sparkles size={15} />}
          </button>
        )}
        <svg
          ref={leaders}
          className="semantic-label-leaders"
          aria-hidden="true"
        >
          {labels.map((n) => (
            <path key={n.id} data-node-id={n.id} />
          ))}
        </svg>
        <div ref={labelsRoot} className="semantic-labels">
          {labels.map((n, i) => {
            const task = tasks.find((t) => t.id === n.taskId);
            const stageTasks =
              n.kind === "stage"
                ? tasks.filter((t) => t.stage === n.stage)
                : [];
            const done = stageTasks.filter(
              (t) => t.state === "completed" || t.state === "skipped",
            ).length;
            const issues = stageTasks.filter((t) =>
              isIssueTask(t.state),
            ).length;
            return (
              <button
                key={n.id}
                data-node-id={n.id}
                className={`semantic-label ${n.kind} ${n.state} ${n.taskId === selectedTask ? "selected" : ""}`}
                style={{ transform: `translate(16px,${20 + i * 52}px)` }}
                onClick={() => choose(n)}
                onDoubleClick={() => {
                  if (n.kind === "stage" && n.stage) zoomStage(n.stage);
                }}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(n.id)}
                onBlur={() => setHovered(null)}
                aria-label={
                  n.kind === "cluster"
                    ? `Expand ${n.label} in ${workStages[n.stage!]}`
                    : n.kind === "result"
                      ? `Inspect result for ${task?.name}`
                      : n.label
                }
                aria-pressed={
                  n.taskId
                    ? selectedTask === n.taskId
                    : n.kind === "stage"
                      ? selected === n.stage
                      : undefined
                }
                title={
                  n.kind === "result" && task ? resultSummary(task) : n.label
                }
              >
                {n.kind === "result" ? (
                  <span className="semantic-label-symbol">
                    {n.state === "completed" ? (
                      <Check size={12} />
                    ) : (
                      <AlertCircle size={12} />
                    )}
                  </span>
                ) : n.kind === "stage" ? (
                  <span className="semantic-label-symbol">
                    {stages.findIndex((s) => s.id === n.stage) + 1}
                  </span>
                ) : n.kind === "task" ? (
                  <span className="semantic-label-symbol">
                    {isIssueTask(n.state as ResearchTask["state"]) ? (
                      <AlertCircle size={12} />
                    ) : n.state === "waiting" ? (
                      <Clock3 size={12} />
                    ) : (
                      <i />
                    )}
                  </span>
                ) : null}
                <span className="semantic-label-body">
                  <strong>{n.kind === "result" ? "Result" : n.label}</strong>
                  {n.kind === "stage" ? (
                    <span className="semantic-label-meta">
                      <span>
                        <i aria-hidden="true" />
                        {stages.find((s) => s.id === n.stage)?.detail}
                      </span>
                      <em>
                        {stageTasks.length
                          ? `${done}/${stageTasks.length} ${stageTasks.length === 1 ? "task" : "tasks"}`
                          : "No tasks yet"}
                      </em>
                    </span>
                  ) : (
                    n.kind !== "core" && (
                      <small>
                        {n.kind === "result" && task
                          ? resultSummary(task)
                          : n.kind === "task"
                            ? taskStatus[n.state as ResearchTask["state"]]
                            : expanded.includes(n.stage!)
                              ? "Open full task list"
                              : "Reveal task nodes"}
                      </small>
                    )
                  )}
                  {n.kind === "stage" && stageTasks.length > 0 && (
                    <span className="neural-stage-track" aria-hidden="true">
                      <i
                        style={{
                          width: `${(done / stageTasks.length) * 100}%`,
                        }}
                      />
                      {issues > 0 && (
                        <b
                          style={{
                            width: `${(issues / stageTasks.length) * 100}%`,
                          }}
                        />
                      )}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {hoverEdge && (
          <div
            ref={chip}
            className="neural-link-chip"
            style={{ visibility: "hidden" }}
            aria-hidden="true"
          >
            <strong>
              {hoverEdge.kind === "result"
                ? "Result"
                : (chipTask?.name ?? chipTarget?.label)}
            </strong>
            <span>
              {chipTask
                ? `${taskStatus[chipTask.state]} · ${elapsed(
                    chipTask.startedAt,
                    chipTask.finishedAt ??
                      (isWorkingTask(chipTask.state)
                        ? new Date().toISOString()
                        : chipTask.updatedAt),
                  )}`
                : (() => {
                    const count = tasks.filter(
                      (t) => t.stage === hoverEdge.stage,
                    ).length;
                    return `${count} ${count === 1 ? "task" : "tasks"} · ${chipStage?.detail ?? ""}`;
                  })()}
            </span>
          </div>
        )}
        {previewNode && previewTask && (
          <div
            ref={preview}
            className={`neural-task-preview ${previewTask.state}`}
            style={{ visibility: "hidden" }}
            role="status"
          >
            <strong>{previewTask.name}</strong>
            <span className="neural-task-preview-state">
              {taskStatus[previewTask.state]} ·{" "}
              {elapsed(
                previewTask.startedAt,
                previewTask.finishedAt ??
                  (isWorkingTask(previewTask.state)
                    ? new Date().toISOString()
                    : previewTask.updatedAt),
              )}
            </span>
            <p>{previewTask.latest.message}</p>
            {previewTask.url && (
              <span className="neural-task-preview-url">
                {previewTask.url.replace(/^https?:\/\//, "")}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="neural-signal-key" aria-label="Neural map legend">
        <span>
          <i className="done" />
          Recorded result
        </span>
        <span>
          <i className="issue" />
          Needs attention
        </span>
        <span>
          <i className="preview" />
          Visual exploration
        </span>
        <small>
          {neuronCount.toLocaleString("en-US")} visual neurons · Core → stage →
          task → result
        </small>
      </div>
      <div className="semantic-path-summary" aria-live="polite">
        <Focus size={13} />
        <div>
          <strong>{path}</strong>
          <span>
            {hoverTask
              ? hoverTask.state === "completed"
                ? resultSummary(hoverTask)
                : hoverTask.latest.message
              : "Hover a link to trace its route. Select a task to inspect its evidence."}
          </span>
        </div>
      </div>
      <div className="research-model-controls">
        <div>
          <button onClick={trace} title="Trace a recorded route; starts no job">
            <Zap size={13} /> Trace a pulse
          </button>
          <button
            aria-pressed={orbiting}
            onClick={() => {
              if (paused) onResume();
              setOrbiting((v) => !v);
            }}
          >
            <Orbit size={14} /> Auto orbit
          </button>
          <button aria-pressed={tissue} onClick={() => setTissue((v) => !v)}>
            {tissue ? <Eye size={14} /> : <EyeOff size={14} />} Neural tissue
          </button>
          <label className="neural-density-control">
            Visual neurons
            <select
              aria-label="Visual neuron density"
              value={neuronCount}
              onChange={(e) => setNeuronCount(Number(e.target.value))}
            >
              {neuralDensities.map((count) => (
                <option key={count} value={count}>
                  {count.toLocaleString("en-US")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div aria-label="Neural model camera">
          <button
            aria-label="Rotate model left"
            onClick={() => command("left")}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            aria-label="Rotate model right"
            onClick={() => command("right")}
          >
            <ChevronRight size={14} />
          </button>
          <button aria-label="Zoom model out" onClick={() => command("out")}>
            <Minus size={14} />
          </button>
          <button aria-label="Zoom model in" onClick={() => command("in")}>
            <Plus size={14} />
          </button>
          <button
            aria-label="Reset model view"
            onClick={() => command("reset")}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
      <p className="research-model-hint">
        Drag to orbit · click a link to follow it · double-click a stage to zoom
        in · arrow keys walk the links
      </p>
    </div>
  );
}
