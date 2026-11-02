import {
  isIssueTask,
  isWorkingTask,
  taskStatus,
  type ResearchTask,
} from "../../shared/research-tasks";
export type FlowFilter = "all" | "running" | "issues";
export function filterFlowTasks(
  tasks: ResearchTask[],
  query: string,
  filter: FlowFilter,
) {
  const term = query.trim().toLocaleLowerCase();
  return tasks.filter(
    (task) =>
      (filter === "all" ||
        (filter === "running"
          ? isWorkingTask(task.state)
          : isIssueTask(task.state))) &&
      (!term ||
        `${task.name} ${task.url ?? ""} ${taskStatus[task.state]}`
          .toLocaleLowerCase()
          .includes(term)),
  );
}
/** Preserve chronology and keep pinned/current tasks reachable without expanding history. */
export function visibleFlowTasks(
  tasks: ResearchTask[],
  limit: number,
  selected: string | null,
  live: boolean,
) {
  return tasks.filter(
    (task, i) =>
      i < limit || task.id === selected || (live && isWorkingTask(task.state)),
  );
}
export type FlowPoint = { x: number; y: number };
export function flowConnection(
  from: FlowPoint,
  to: FlowPoint,
  outerRail?: number,
) {
  const rail = outerRail ?? from.x;
  const y = Math.max(from.y + 12, to.y - 24),
    direction = to.x < rail ? -1 : 1;
  const lead =
    outerRail === undefined
      ? ""
      : ` L${rail + 8} ${from.y + 10} Q${rail} ${from.y + 10} ${rail} ${from.y + 18}`;
  return `M${from.x} ${from.y}${lead} L${rail} ${y} Q${rail} ${y + 10} ${rail + direction * 10} ${y + 10} L${to.x - direction * 10} ${y + 10} Q${to.x} ${y + 10} ${to.x} ${to.y}`;
}
