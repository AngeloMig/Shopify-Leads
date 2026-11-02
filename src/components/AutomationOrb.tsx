import { lazy, Suspense } from "react";
import { targetFor } from "../../shared/job-activity";
import type { Job } from "../../shared/types";

const MiniCore = lazy(() => import("./MiniCore"));
/** A small S.C.O.U.T. core, shown away from Automation Jobs while work is running. */
export function AutomationOrb({
  jobs,
  onOpen,
}: {
  jobs: Job[];
  onOpen: (job: Job) => void;
}) {
  if (!jobs.length) return null;
  const job = jobs[0];
  const summary = `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"} running`;
  const target = targetFor(job);
  const detail = `${job.type === "discovery" ? "Discovery" : "Audit"} · ${target.domain ?? target.label} · ${job.progress}%`;
  return (
    <button
      className="automation-orb"
      aria-label={`${summary}. ${detail}. Open Automation Jobs.`}
      onClick={() => onOpen(job)}
    >
      <span className="automation-orb-label" aria-hidden="true">
        <strong>{summary}</strong>
        <small>{detail}</small>
      </span>
      <span className="automation-orb-core" aria-hidden="true">
        <Suspense fallback={null}>
          <MiniCore state={job.type === "discovery" ? "discover" : "audit"} />
        </Suspense>
      </span>
    </button>
  );
}
