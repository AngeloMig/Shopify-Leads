import { describe, it, expect } from "vitest";
import {
  researchTasks,
  observedFinalization,
  taskForEvent,
  resultSummary,
  isWorkingTask,
} from "../shared/research-tasks";
import { readWork, type WorkEvent } from "../shared/job-activity";
import { previewRun, previewLength } from "../src/components/research-preview";
function run(events: WorkEvent[]) {
  const d = previewRun("audit", 0, 0);
  d.job.id = "run";
  d.job.payload.work = {
    version: 1,
    stage: "measure",
    target: d.target,
    updated_at: events.at(-1)?.at,
    events,
  };
  return d;
}
const event = (
  id: string,
  task: string,
  state: WorkEvent["task_state"],
  at = 0,
): WorkEvent => ({
  id,
  task_id: task,
  parent_id: "measure",
  task_name: task,
  task_state: state,
  stage: "measure",
  state: state === "starting" ? "started" : "note",
  attempt: 1,
  at: new Date(at).toISOString(),
  message: `${task}: ${state}`,
  facts: { strategy: "mobile", sample: 1 },
});
describe("Worker task projection", () => {
  it("updates stable tasks and preserves concurrent branches and each result", () => {
    const d = run([
      event("1", "mobile", "starting"),
      event("2", "desktop", "starting", 1000),
      event("3", "mobile", "waiting", 2000),
      {
        ...event("4", "mobile", "completed", 4000),
        facts: { performance: 48, seo: 82, sample: 1 },
      },
    ]);
    const tasks = researchTasks(d);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].events).toHaveLength(3);
    expect(tasks[0].startedAt).toBe(new Date(0).toISOString());
    expect(tasks[0].finishedAt).toBe(new Date(4000).toISOString());
    expect(isWorkingTask(tasks[1].state)).toBe(true);
    expect(taskForEvent(tasks, "3")?.id).toBe("mobile");
    expect(resultSummary(tasks[0])).toContain(
      "Performance 48/100 · SEO 82/100",
    );
    expect(tasks[0].parent).toBe("measure");
  });
  it("keeps old attempts inspectable and never invents a result for interrupted work", () => {
    const d = run([event("1", "old", "waiting")]);
    d.job.attempts = 2;
    expect(researchTasks(d)[0].state).toBe("interrupted");
    d.job.attempts = 1;
    d.job.status = "completed";
    expect(researchTasks(d)[0].state).toBe("recorded");
    d.job.status = "queued";
    d.job.error = "Provider rate limit";
    expect(researchTasks(d)[0].state).toBe("retrying");
    d.job.status = "blocked";
    expect(researchTasks(d)[0].state).toBe("failed");
  });
  it("retains all recorded events over reconnect snapshots and strips unsafe task metadata", () => {
    const events = Array.from({ length: 150 }, (_, i) =>
      event(String(i), "task", "running", i * 1000),
    );
    expect(readWork(run(events).job.payload.work)?.events).toHaveLength(150);
    const bad = {
      ...event("bad", "task", "running"),
      task_state: "hacked",
      task_name: 900,
    };
    const validated = readWork(
      run([bad as unknown as WorkEvent]).job.payload.work,
    )?.events[0];
    expect(validated?.task_state).toBeUndefined();
    expect(validated?.task_name).toBeUndefined();
  });
  it("observes finalization only after both the job and owned report have completed", () => {
    const pending = {
      ...event("final-start", "run:1:report:finalize", "running"),
      stage: "report" as const,
    };
    const d = run([pending]);
    d.job.status = "completed";
    d.job.completed_at = new Date(9000).toISOString();
    expect(observedFinalization(d.job, null)?.events).toHaveLength(1);
    d.job.status = "running";
    expect(observedFinalization(d.job, "report")?.events).toHaveLength(1);
    d.job.status = "completed";
    const work = observedFinalization(d.job, "report")!;
    expect(work.events.at(-1)?.task_state).toBe("completed");
    expect(work.events.at(-1)?.at).toBe(d.job.completed_at);
    d.job.payload.work = work;
    expect(observedFinalization(d.job, "report")?.events).toHaveLength(2);
  });
  it("shows only measurements actually returned in the fictional preview", () => {
    const done = previewRun("audit", previewLength("audit") - 1, 0);
    expect(done.measurements).toHaveLength(6);
    expect(
      researchTasks(done).filter(
        (t) => typeof t.facts.performance === "number",
      ),
    ).toHaveLength(6);
    const events = readWork(done.job.payload.work)!.events;
    const firstResult = events.findIndex(
      (e) => typeof e.facts?.performance === "number",
    );
    expect(previewRun("audit", firstResult - 1, 0).measurements).toHaveLength(
      0,
    );
    expect(previewRun("audit", firstResult, 0).measurements).toHaveLength(1);
    expect(
      researchTasks(done).some(
        (t) => t.name === "Render audit PDF" && t.state === "completed",
      ),
    ).toBe(true);
  });
});
