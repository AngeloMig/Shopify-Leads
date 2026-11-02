import { describe, expect, it } from "vitest";
import {
  filterFlowTasks,
  visibleFlowTasks,
  flowConnection,
} from "../src/components/task-flow-model";
import { researchTasks } from "../shared/research-tasks";
import { previewLength, previewRun } from "../src/components/research-preview";
const tasks = researchTasks(previewRun("audit", previewLength("audit") - 1, 0));
describe("Task flow exploration", () => {
  it("finds recorded resources and combines search with status filters", () => {
    const product = filterFlowTasks(tasks, "FACE-SERUM", "all");
    expect(product.map((t) => t.name)).toEqual(["Review product page"]);
    expect(filterFlowTasks(tasks, "face-serum", "issues")).toEqual([]);
    const issues = tasks.map((t, i) =>
      i === 0 ? { ...t, state: "failed" as const } : t,
    );
    expect(
      filterFlowTasks(issues, "connect", "issues").map((t) => t.id),
    ).toEqual([tasks[0].id]);
  });
  it("keeps pinned and current tasks visible in chronological order without duplicates", () => {
    const selected = tasks.at(-1)!.id;
    const waiting = tasks.map((t, i) =>
      i === 5 ? { ...t, state: "waiting" as const } : t,
    );
    const shown = visibleFlowTasks(waiting, 3, selected, true);
    expect(shown.map((t) => t.id)).toEqual([
      tasks[0].id,
      tasks[1].id,
      tasks[2].id,
      tasks[5].id,
      selected,
    ]);
    expect(visibleFlowTasks(waiting, 3, selected, false)).toHaveLength(4);
    expect(visibleFlowTasks(waiting, 100, selected, true)).toHaveLength(
      tasks.length,
    );
  });
  it("anchors both desktop and narrow-screen routes to the measured endpoints", () => {
    for (const rail of [undefined, 8]) {
      const path = flowConnection({ x: 330, y: 86 }, { x: 160, y: 450 }, rail);
      expect(path.startsWith("M330 86")).toBe(true);
      expect(path.endsWith("160 450")).toBe(true);
      expect(path).not.toMatch(/NaN|undefined|Infinity/);
      // The vertical trunk stays in the gap, or at the explicit outer rail.
      expect(path).toContain(`L${rail ?? 330} 426`);
    }
  });
});
