import type { RunDetail } from "../../shared/job-activity";
import type { ResearchTask } from "../../shared/research-tasks";

export const corePalettes = [
  {
    id: "gold",
    name: "Gold leaf",
    colors: ["#e0b75c", "#f3eee2", "#fff8e8"],
  },
  {
    id: "polar",
    name: "Polar current",
    colors: ["#83ffe0", "#72a8ff", "#e3fff6"],
  },
  {
    id: "solar",
    name: "Solar tide",
    colors: ["#75ddf4", "#ffca83", "#fff0d4"],
  },
  {
    id: "orchid",
    name: "Orchid engine",
    colors: ["#c8a6ff", "#79f1ca", "#f4ecff"],
  },
] as const;
export type CorePalette = (typeof corePalettes)[number]["id"];
export const coreStates = {
  ready: { label: "Ready", color: "#d3bc8e" },
  discover: { label: "Discovering", color: "#fbcc67" },
  verify: { label: "Verifying", color: "#edc164" },
  audit: { label: "Auditing", color: "#f3eee2" },
  inspect: { label: "Inspecting", color: "#c9a86a" },
  report: { label: "Building report", color: "#ffd08a" },
  waiting: { label: "Waiting for response", color: "#dcc597" },
  retry: { label: "Retrying", color: "#ffb564" },
  attention: { label: "Needs attention", color: "#ff8c81" },
  complete: { label: "Complete", color: "#68e6b0" },
} as const;
export type CoreState = keyof typeof coreStates;
export type CoreEvidence = { id: string; label: string; ready: boolean };
export type CoreAppearance = {
  state: CoreState;
  working: boolean;
  palette: CorePalette;
  evidence: CoreEvidence[];
};
/** Read current execution, never the selected historical task. Terminal job state wins over stale task events. */
export function coreState(
  tasks: ResearchTask[],
  active: boolean,
  status?: string,
): CoreState {
  if (status === "completed") return "complete";
  if (["failed", "blocked"].includes(status ?? "")) return "attention";
  if (!active)
    return ["queued", "cancelled", "running"].includes(status ?? "")
      ? "waiting"
      : "ready";
  const current = tasks
    .filter((t) =>
      ["starting", "running", "waiting", "retrying"].includes(t.state),
    )
    .reduce<
      ResearchTask | undefined
    >((latest, task) => (!latest || task.updatedAt > latest.updatedAt ? task : latest), undefined);
  if (current?.state === "retrying") return "retry";
  if (current?.state === "waiting") return "waiting";
  if (!current) return "waiting";
  return (
    {
      search: "discover",
      prepare: "discover",
      queue: "verify",
      verify: "verify",
      measure: "audit",
      inspect: "inspect",
      report: "report",
    } as const
  )[current.stage];
}
export const coreIsWorking = (state: CoreState) =>
  ["discover", "verify", "audit", "inspect", "report"].includes(state);
export function coreEvidence(
  detail: RunDetail | null,
  tasks: ResearchTask[],
  kind: "audit" | "discovery",
): CoreEvidence[] {
  const contact = tasks.some(
    (t) =>
      t.state === "completed" &&
      typeof t.facts.emails === "number" &&
      t.facts.emails > 0,
  );
  if (kind === "discovery")
    return [
      {
        id: "search",
        label: "Search returned",
        ready: tasks.some(
          (t) => t.stage === "search" && t.state === "completed",
        ),
      },
      {
        id: "verify",
        label: "Store verified",
        ready: tasks.some(
          (t) =>
            t.stage === "verify" &&
            t.state === "completed" &&
            (t.facts.shopify === true || t.facts.verified === true),
        ),
      },
      { id: "contact", label: "Public contact", ready: contact },
      {
        id: "queue",
        label: "Audit queued",
        ready: tasks.some(
          (t) => t.stage === "queue" && t.state === "completed",
        ),
      },
    ];
  return [
    {
      id: "measure",
      label: "Measurements saved",
      ready: !!detail?.measurements.length,
    },
    { id: "pages", label: "Pages recorded", ready: !!detail?.pages.length },
    { id: "contact", label: "Public contact", ready: contact },
    { id: "report", label: "Report ready", ready: !!detail?.report_id },
  ];
}
/** Five seconds to charge, 3.2 seconds to settle. Animation time excludes paused/hidden time. */
export function stepCoreDrive(drive: number, working: boolean, delta: number) {
  return Math.max(
    0,
    Math.min(1, drive + Math.max(0, delta) * (working ? 1 / 5 : -1 / 3.2)),
  );
}
export const coreEnergy = (drive: number) => drive * drive * (3 - 2 * drive);
