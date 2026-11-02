import { describe, expect, it } from "vitest";
import {
  coreEvidence,
  coreState,
  stepCoreDrive,
  coreEnergy,
} from "../src/components/scout-core-model";
import { researchTasks } from "../shared/research-tasks";
import { previewRun, previewLength } from "../src/components/research-preview";
const detail = previewRun("audit", previewLength("audit") - 1, 0);
const tasks = researchTasks(detail);
const task = tasks[0];
describe("Scout core execution and evidence", () => {
  it("does not let stale running events override a terminal job", () => {
    const stale = {
      ...task,
      state: "running" as const,
      stage: "measure" as const,
    };
    expect(coreState([stale], false, "completed")).toBe("complete");
    expect(coreState([stale], false, "blocked")).toBe("attention");
    expect(coreState([stale], false, "queued")).toBe("waiting");
  });
  it("uses the latest current task rather than the last selected/history entry", () => {
    const active = {
      ...task,
      state: "running" as const,
      stage: "measure" as const,
      updatedAt: "2026-10-29T03:00:00Z",
    };
    const old = {
      ...active,
      stage: "inspect" as const,
      updatedAt: "2026-10-29T02:00:00Z",
    };
    expect(coreState([active, old], true, "running")).toBe("audit");
    expect(coreState([{ ...active, state: "waiting" }], true, "running")).toBe(
      "waiting",
    );
    expect(coreState([{ ...active, state: "retrying" }], true, "running")).toBe(
      "retry",
    );
  });
  it("never infers a saved measurement, page or report from task completion alone", () => {
    expect(
      coreEvidence(
        null,
        [{ ...task, state: "completed", facts: {} }],
        "audit",
      ).every((e) => !e.ready),
    ).toBe(true);
    expect(coreEvidence(detail, tasks, "audit").map((e) => e.ready)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
  it("requires positive Shopify evidence rather than a completed rejected check", () => {
    const verified = {
      ...task,
      stage: "verify" as const,
      state: "completed" as const,
      facts: { shopify: false },
    };
    expect(coreEvidence(null, [verified], "discovery")[1].ready).toBe(false);
    expect(
      coreEvidence(
        null,
        [{ ...verified, facts: { shopify: true } }],
        "discovery",
      )[1].ready,
    ).toBe(true);
  });
  it("charges gradually, freezes with zero elapsed animation time, and cools without an angle reset", () => {
    let drive = 0;
    for (let i = 0; i < 150; i++) drive = stepCoreDrive(drive, true, 1 / 30);
    expect(drive).toBeCloseTo(1);
    expect(stepCoreDrive(drive, false, 0)).toBe(drive);
    expect(coreEnergy(0.5)).toBeCloseTo(0.5);
    for (let i = 0; i < 96; i++) drive = stepCoreDrive(drive, false, 1 / 30);
    expect(drive).toBeCloseTo(0);
  });
});
