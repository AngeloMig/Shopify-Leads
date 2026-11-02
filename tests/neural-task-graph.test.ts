import { describe, it, expect } from "vitest";
import {
  buildTaskGraph,
  signalRoute,
  pointOnRoute,
  placeLabels,
} from "../src/components/neural-task-graph";
import { researchTasks } from "../shared/research-tasks";
import { previewRun, previewLength } from "../src/components/research-preview";
import type { NetworkStage } from "../src/components/research-network-model";
const stages: NetworkStage[] = [
  {
    id: "verify",
    label: "Verify storefront",
    state: "completed",
    detail: "Done",
  },
  {
    id: "measure",
    label: "Measure performance",
    state: "completed",
    detail: "Done",
  },
  { id: "inspect", label: "Review pages", state: "completed", detail: "Done" },
  { id: "report", label: "Build report", state: "completed", detail: "Done" },
];
const tasks = researchTasks(previewRun("audit", previewLength("audit") - 1, 0));
const target = tasks.find(
  (t) => t.facts.strategy === "desktop" && t.facts.sample === 3,
)!;
const options = {
  view: "overview" as const,
  stage: "measure" as const,
  taskId: target.id,
  expanded: [],
  signals: [],
};
describe("Task-linked neural graph", () => {
  it("connects stable worker task IDs through stage, task and result nodes", () => {
    const graph = buildTaskGraph(stages, tasks, options);
    const task = graph.nodes.find((n) => n.id === `task:${target.id}`)!;
    expect(task.taskId).toBe(target.id);
    const route = graph.edges.filter(
      (e) =>
        e.stage === "measure" &&
        (e.kind === "primary" || e.taskId === target.id),
    );
    expect(route.map((e) => [e.source, e.target])).toEqual([
      ["scout", "stage:measure"],
      ["stage:measure", task.id],
      [task.id, `result:${target.id}`],
    ]);
    expect(new Set(graph.nodes.map((n) => n.id)).size).toBe(graph.nodes.length);
  });
  it("dispatches and returns on the exact visible connection points", () => {
    const graph = buildTaskGraph(stages, tasks, options);
    const dispatch = signalRoute(graph, {
      id: "start",
      stage: "measure",
      taskId: target.id,
      back: false,
    });
    const result = signalRoute(graph, {
      id: "return",
      stage: "measure",
      taskId: target.id,
      back: true,
    });
    expect(dispatch[0]).toEqual([0, 0, 0]);
    expect(dispatch.at(-1)).toEqual(
      graph.nodes.find((n) => n.id === `task:${target.id}`)?.position,
    );
    expect(result[0]).toEqual(
      graph.nodes.find((n) => n.id === `result:${target.id}`)?.position,
    );
    expect(result.at(-1)).toEqual([0, 0, 0]);
    const vertices = graph.edges.flatMap((e) => e.points);
    for (const p of dispatch) expect(vertices).toContainEqual(p);
    expect(pointOnRoute(dispatch, 0)).toEqual(dispatch[0]);
    expect(pointOnRoute(dispatch, 1)).toEqual(dispatch.at(-1));
  });
  it("keeps task positions stable across focus changes and newer tasks", () => {
    const overview = buildTaskGraph(stages, tasks, options),
      focused = buildTaskGraph(stages, tasks, { ...options, view: "stage" });
    for (const node of overview.nodes.filter((n) => n.taskId))
      expect(focused.nodes.find((n) => n.id === node.id)?.position).toEqual(
        node.position,
      );
    expect(
      focused.nodes.filter((n) => n.kind === "task" && n.stage === "measure")
        .length,
    ).toBeGreaterThan(
      overview.nodes.filter((n) => n.kind === "task" && n.stage === "measure")
        .length,
    );
    const hidden = overview.nodes
      .filter((n) => n.kind === "cluster")
      .reduce((n, c) => n + c.count!, 0);
    expect(
      overview.nodes.filter((n) => n.kind === "task").length + hidden,
    ).toBe(tasks.length);
  });
  it("retains signaled task nodes when they are outside the overview selection", () => {
    const old = tasks.find((t) => t.stage === "inspect")!;
    const graph = buildTaskGraph(stages, tasks, {
      ...options,
      signals: [{ id: "result", taskId: old.id, stage: old.stage, back: true }],
    });
    expect(graph.nodes.some((n) => n.taskId === old.id)).toBe(true);
  });
  it("places readable labels within bounds without collisions", () => {
    const labels = Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      x: 20,
      y: 200,
      width: 154,
      height: 48,
      priority: 100 - i,
    }));
    const result = placeLabels(labels, 660, 530).filter((p) => p.visible);
    expect(result.length).toBeGreaterThan(3);
    for (const a of result) {
      expect(a.x).toBeGreaterThanOrEqual(8);
      expect(a.y + a.height).toBeLessThanOrEqual(520);
      for (const b of result.filter((b) => b.id !== a.id))
        expect(
          a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y,
        ).toBe(false);
    }
  });
});
