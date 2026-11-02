import { createHash, randomUUID } from "node:crypto";
import { checked, db, now } from "./db.js";
import {
  readWork,
  publicActivityUrl,
  type JobWork,
  type WorkEvent,
  type WorkTarget,
  type WorkStage,
} from "../../shared/job-activity.js";
import { inferTask, type TaskDescriptor } from "../../shared/research-tasks.js";
import type { Job } from "../../shared/types.js";
export type ActivityEmitter = (
  stage: WorkStage,
  state: WorkEvent["state"],
  message: string,
  options?: {
    url?: string;
    facts?: WorkEvent["facts"];
    target?: WorkTarget;
    task?: TaskDescriptor;
  },
) => Promise<void>;
export function jobActivity(
  job: Job & { organization_id: string; worker_id: string },
  publish: (work: JobWork) => Promise<void>,
): ActivityEmitter {
  let current = readWork(job.payload.work);
  let pending: Promise<void> = Promise.resolve();
  return (stage, state, message, options = {}) => {
    const publishNext = async () => {
      const at = now();
      const facts = Object.fromEntries(
        Object.entries(options.facts ?? {})
          .filter(
            ([, v]) =>
              v === null ||
              typeof v === "boolean" ||
              typeof v === "string" ||
              (typeof v === "number" && Number.isFinite(v)),
          )
          .slice(0, 12)
          .map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 500) : v]),
      );
      const event: WorkEvent = {
        id: randomUUID(),
        at,
        attempt: job.attempts,
        stage,
        state,
        message: message.slice(0, 600),
        url: publicActivityUrl(options.url),
        facts,
      };
      const task = options.task ?? inferTask(event);
      event.scope = options.task ? "task" : "stage";
      const publicKey = task.key.replace(
        /https?:\/\/\S+/g,
        (value) => publicActivityUrl(value) ?? "invalid-resource",
      );
      const key =
        publicKey.length > 400
          ? createHash("sha256").update(publicKey).digest("hex")
          : publicKey;
      event.task_id = `${job.id}:${job.attempts}:${stage}:${key}`;
      event.parent_id = task.parent ?? stage;
      event.task_name = task.name.slice(0, 200);
      event.task_state = task.state ?? inferTask(event).state;
      const target = options.target ??
        current?.target ?? {
          label: job.type === "discovery" ? "Store discovery" : "Website audit",
        };
      const work: JobWork = {
        version: 1,
        stage,
        updated_at: at,
        target: {
          ...target,
          label: target.label.slice(0, 200),
          url: publicActivityUrl(target.url),
        },
        events: [...(current?.events ?? []), event],
      };
      await publish(work);
      current = work;
    };
    const result = pending.then(publishNext);
    pending = result.catch(() => {});
    return result;
  };
}
export async function publishJobWork(
  job: Job & { organization_id: string; worker_id: string },
  payload: Record<string, unknown>,
) {
  const row = await checked(
    db()
      .from("automation_jobs")
      .update({ payload })
      .eq("organization_id", job.organization_id)
      .eq("id", job.id)
      .eq("worker_id", job.worker_id)
      .eq("status", "running")
      .gt("lease_until", now())
      .select("id")
      .maybeSingle(),
  );
  if (!row) throw new Error("Worker lease lost");
}

/** Record interruption before settle_job_failure releases the ownership fence. */
export async function recordJobFailure(
  job: Job & { organization_id: string; worker_id: string },
  message: string,
  retrying: boolean,
) {
  const row = await checked(
    db()
      .from("automation_jobs")
      .select("payload")
      .eq("id", job.id)
      .eq("organization_id", job.organization_id)
      .eq("worker_id", job.worker_id)
      .eq("status", "running")
      .maybeSingle(),
  );
  if (!row) return;
  const work = readWork(row.payload.work);
  if (!work) return;
  const last = new Map<string, WorkEvent>();
  for (const event of work.events)
    if (event.task_id && event.attempt === job.attempts)
      last.set(event.task_id, event);
  const at = now();
  const interrupted = [...last.values()]
    .filter((e) =>
      ["starting", "running", "waiting"].includes(e.task_state ?? ""),
    )
    .map((e) => ({
      ...e,
      id: randomUUID(),
      at,
      state: "note" as const,
      task_state: retrying ? ("retrying" as const) : ("failed" as const),
      message: message.slice(0, 600),
    }));
  if (!interrupted.length) return;
  await publishJobWork(job, {
    ...row.payload,
    work: { ...work, updated_at: at, events: [...work.events, ...interrupted] },
  });
}
