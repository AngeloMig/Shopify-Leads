import type { WorkStage } from "../../shared/job-activity";
import {
  isIssueTask,
  isWorkingTask,
  type ResearchTask,
} from "../../shared/research-tasks";
import {
  clusterCenters,
  type NetworkStage,
  type NetworkPoint,
} from "./research-network-model";
export type NeuralView = "overview" | "stage" | "task";
/** Projected midpoint of the hovered link, used to place its hover chip. */
export const linkChipId = "link-chip";
/** Projected point just below the core on screen, where the S.C.O.U.T. name sits. */
export const coreAnchorId = "core-anchor";
export type SemanticNode = {
  id: string;
  kind: "core" | "stage" | "task" | "result" | "cluster";
  position: NetworkPoint;
  stage?: WorkStage;
  taskId?: string;
  label: string;
  state: string;
  count?: number;
};
export type SemanticEdge = {
  id: string;
  source: string;
  target: string;
  kind: "primary" | "branch" | "result";
  stage: WorkStage;
  taskId?: string;
  points: NetworkPoint[];
};
export type SemanticGraph = { nodes: SemanticNode[]; edges: SemanticEdge[] };
export type ActivitySignal = {
  id: string;
  stage: WorkStage;
  back: boolean;
  taskId?: string;
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function curvedLink(
  a: NetworkPoint,
  b: NetworkPoint,
  kind: SemanticEdge["kind"],
): NetworkPoint[] {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    bend = kind === "primary" ? 0.3 : 0.13;
  const c: NetworkPoint = [
    mix(a[0], b[0], 0.32) - dy * bend,
    mix(a[1], b[1], 0.32) + dx * bend,
    mix(a[2], b[2], 0.32) + 0.18,
  ];
  const d: NetworkPoint = [
    mix(a[0], b[0], 0.72) - dy * bend,
    mix(a[1], b[1], 0.72) + dx * bend,
    mix(a[2], b[2], 0.72) + 0.1,
  ];
  return Array.from({ length: 33 }, (_, i) => {
    const t = i / 32,
      u = 1 - t;
    return a.map(
      (v, k) =>
        u * u * u * v +
        3 * u * u * t * c[k] +
        3 * u * t * t * d[k] +
        t * t * t * b[k],
    ) as NetworkPoint;
  });
}
/** Position uses insertion order across the complete stage history, independent of view/filter. */
export function taskPosition(
  stageIndex: number,
  ordinal: number,
  spread = 1,
): NetworkPoint {
  const hub = clusterCenters[stageIndex],
    angle = ordinal * 2.399963 + stageIndex * 0.7,
    r = (0.44 + Math.min(1, Math.floor(ordinal / 6) * 0.14)) * spread;
  return [
    hub[0] + Math.cos(angle) * r * 0.93,
    hub[1] + Math.sin(angle) * r * 0.72,
    hub[2] + Math.sin(ordinal * 1.3) * 0.52,
  ];
}
export function buildTaskGraph(
  stages: NetworkStage[],
  tasks: ResearchTask[],
  options: {
    view: NeuralView;
    stage: WorkStage | null;
    taskId: string | null;
    expanded: WorkStage[];
    signals: ActivitySignal[];
    /** A stage zoomed into: its tasks fan out further from the hub. */
    spread?: WorkStage | null;
  },
): SemanticGraph {
  const nodes: SemanticNode[] = [
      {
        id: "scout",
        kind: "core",
        position: [0, 0, 0],
        label: "S.C.O.U.T.",
        state: "core",
      },
    ],
    edges: SemanticEdge[] = [];
  const addEdge = (
    source: SemanticNode,
    target: SemanticNode,
    kind: SemanticEdge["kind"],
    stage: WorkStage,
    taskId?: string,
  ) =>
    edges.push({
      id: `${source.id}->${target.id}`,
      source: source.id,
      target: target.id,
      kind,
      stage,
      taskId,
      points: curvedLink(source.position, target.position, kind),
    });
  stages.forEach((stage, index) => {
    const hub: SemanticNode = {
      id: `stage:${stage.id}`,
      kind: "stage",
      stage: stage.id,
      position: clusterCenters[index],
      label: stage.label,
      state: stage.state,
    };
    nodes.push(hub);
    addEdge(nodes[0], hub, "primary", stage.id);
    const history = tasks.filter((task) => task.stage === stage.id),
      latest = history.at(-1);
    const visible = history.filter(
      (task, i) =>
        isWorkingTask(task.state) ||
        isIssueTask(task.state) ||
        task.id === options.taskId ||
        options.signals.some((s) => s.taskId === task.id) ||
        task === latest ||
        (options.view !== "overview" &&
          stage.id === options.stage &&
          i < (options.expanded.includes(stage.id) ? 24 : 8)),
    );
    for (const task of visible) {
      const ordinal = history.indexOf(task),
        node: SemanticNode = {
          id: `task:${task.id}`,
          kind: "task",
          taskId: task.id,
          stage: stage.id,
          label: task.name,
          state: task.state,
          position: taskPosition(
            index,
            ordinal,
            stage.id === options.spread ? 1.75 : 1,
          ),
        };
      nodes.push(node);
      addEdge(hub, node, "branch", stage.id, task.id);
      if (
        ["completed", "failed", "skipped", "interrupted"].includes(task.state)
      ) {
        const delta = node.position.map((v, k) => v - hub.position[k]),
          length = Math.hypot(...delta) || 1;
        const result: SemanticNode = {
          ...node,
          id: `result:${task.id}`,
          kind: "result",
          label:
            task.state === "completed"
              ? "Result received"
              : task.state === "skipped"
                ? "Skipped"
                : "Issue recorded",
          position: node.position.map(
            (v, k) => v + (delta[k] / length) * 0.27,
          ) as NetworkPoint,
        };
        nodes.push(result);
        addEdge(node, result, "result", stage.id, task.id);
      }
    }
    const hidden = history.length - visible.length;
    if (hidden) {
      const cluster: SemanticNode = {
        id: `cluster:${stage.id}`,
        kind: "cluster",
        stage: stage.id,
        position: [hub.position[0] * 1.25, hub.position[1] * 1.55, -0.25],
        label: `${hidden} more recorded tasks`,
        state: "recorded",
        count: hidden,
      };
      nodes.push(cluster);
      addEdge(hub, cluster, "branch", stage.id);
    }
  });
  return { nodes, edges };
}
export function signalRoute(
  graph: SemanticGraph,
  signal: ActivitySignal,
): NetworkPoint[] {
  const route = graph.edges.filter(
    (e) =>
      e.stage === signal.stage &&
      (e.kind === "primary" ||
        (!!signal.taskId &&
          e.taskId === signal.taskId &&
          (signal.back || e.kind !== "result"))),
  );
  const points = route.flatMap((edge, i) =>
    i ? edge.points.slice(1) : edge.points,
  );
  return signal.back ? [...points].reverse() : points;
}
export const routeLength = (points: NetworkPoint[]) =>
  points
    .slice(1)
    .reduce(
      (sum, p, i) => sum + Math.hypot(...p.map((v, k) => v - points[i][k])),
      0,
    );
/** Signals traverse the same sampled polyline used by each visible connection. */
export function pointOnRoute(
  points: NetworkPoint[],
  fraction: number,
): NetworkPoint {
  if (!points.length) return [0, 0, 0];
  if (fraction <= 0) return points[0];
  if (fraction >= 1) return points.at(-1)!;
  if (points.length === 1) return points[0];
  const lengths = points
      .slice(1)
      .map((p, i) => Math.hypot(...p.map((v, k) => v - points[i][k]))),
    total = lengths.reduce((a, b) => a + b, 0);
  let distance = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] ? distance / lengths[i] : 0;
      return points[i].map((v, k) =>
        mix(v, points[i + 1][k], f),
      ) as NetworkPoint;
    }
    distance -= lengths[i];
  }
  return points.at(-1)!;
}
export type ProjectedLabel = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
};
export function placeLabels(
  labels: ProjectedLabel[],
  width: number,
  height: number,
) {
  const placed: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
  }[] = [];
  for (const label of [...labels].sort((a, b) => b.priority - a.priority)) {
    let found = false;
    const step = label.height + 8;
    for (const offset of [
      0,
      -step,
      step,
      -step * 2,
      step * 2,
      -step * 3,
      step * 3,
      -step * 4,
      step * 4,
    ]) {
      const x = Math.max(8, Math.min(width - label.width - 8, label.x)),
        y = Math.max(
          10,
          Math.min(height - label.height - 10, label.y + offset),
        );
      if (
        placed.some(
          (p) =>
            p.visible &&
            x < p.x + p.width + 6 &&
            x + label.width + 6 > p.x &&
            y < p.y + p.height + 5 &&
            y + label.height + 5 > p.y,
        )
      )
        continue;
      placed.push({ ...label, x, y, visible: true });
      found = true;
      break;
    }
    if (!found) placed.push({ ...label, visible: false });
  }
  return placed;
}
export const semanticColor = (state: string) =>
  state === "failed" || state === "interrupted"
    ? "#eea099"
    : state === "retrying" || state === "attention"
      ? "#efc27f"
      : state === "completed"
        ? "#e2bb6c"
        : state === "waiting"
          ? "#dec799"
          : state === "active" || isWorkingTask(state as ResearchTask["state"])
            ? "#ffe494"
            : "#988257";
