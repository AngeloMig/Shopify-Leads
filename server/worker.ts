import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { db, checked, configured, now } from "./lib/db.js";
import { executeJob } from "./pipeline.js";
import { purgeExpiredResearch } from "./retention.js";
import { recordJobFailure } from "./lib/job-activity.js";
import { failureDecision } from "./lib/job-errors.js";
const worker = randomUUID();
await writeFile(
  process.env.SCOUT_WORKER_ID_FILE || "/tmp/scout-worker-id",
  worker,
  { mode: 0o600 },
);
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
if (!configured())
  throw new Error(
    "Worker requires SUPABASE_URL and SUPABASE_SECRET_KEY. Copy .env.example and configure Supabase.",
  );
await checked(db().from("automation_jobs").select("id").limit(1));
console.info("Scout worker connected to Supabase", worker);
const paused = process.env.WORKER_PAUSED === "true";
console.info(
  paused
    ? "Job processing paused. Restart without WORKER_PAUSED=true when provider credentials are ready."
    : "Job processing enabled.",
);
let currentJob: string | null = null;
let heartbeatBusy = false;
const reportHeartbeat = async (
  state: "idle" | "working" | "paused" | "stopped" = paused
    ? "paused"
    : currentJob
      ? "working"
      : "idle",
) => {
  if (heartbeatBusy) return;
  heartbeatBusy = true;
  try {
    const orgs = await checked(db().from("organizations").select("id"));
    if (orgs.length)
      await checked(
        db()
          .from("worker_heartbeats")
          .upsert(
            orgs.map((org) => ({
              organization_id: org.id,
              worker_id: worker,
              last_seen: now(),
              state,
              job_id: currentJob,
            })),
            { onConflict: "organization_id,worker_id" },
          ),
      );
  } catch (e) {
    console.error(
      "Worker heartbeat failed:",
      e instanceof Error ? e.message : "unknown",
    );
  } finally {
    heartbeatBusy = false;
  }
};
await reportHeartbeat();
const healthTimer = setInterval(() => void reportHeartbeat(), 20000);
let lastRetentionCheck = 0;
while (!stopping) {
  try {
    if (paused) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (Date.now() - lastRetentionCheck > 3600000) {
      await purgeExpiredResearch().catch((e) =>
        console.error(
          "Retention cleanup failed:",
          e instanceof Error ? e.message : "unknown",
        ),
      );
      lastRetentionCheck = Date.now();
    }
    await checked(db().rpc("enqueue_due_schedules"));
    const jobs = await checked(db().rpc("claim_job", { worker }));
    const job = jobs[0];
    if (!job) {
      await new Promise((r) =>
        setTimeout(
          r,
          Math.max(1000, Number(process.env.WORKER_POLL_MS) || 5000),
        ),
      );
      continue;
    }
    currentJob = job.id;
    await reportHeartbeat();
    const heartbeat = setInterval(() => {
      void db()
        .from("automation_jobs")
        .update({ lease_until: new Date(Date.now() + 180000).toISOString() })
        .eq("id", job.id)
        .eq("worker_id", worker)
        .eq("status", "running")
        .then(({ error }) => {
          if (error) console.error("Heartbeat failed", error.message);
        });
    }, 30000);
    try {
      await executeJob(job);
      await checked(
        db()
          .from("automation_jobs")
          .update({
            status: "completed",
            progress: 100,
            completed_at: now(),
            lease_until: null,
            worker_id: null,
            error: null,
            wait_reason: null,
            error_code: null,
            error_provider: null,
          })
          .eq("id", job.id)
          .eq("worker_id", worker)
          .eq("status", "running"),
      );
    } catch (e) {
      const decision = failureDecision(e, job.attempts, job.max_attempts);
      if (decision.status === "lost") {
        console.info(
          `Job ${job.id}: ownership ended; leaving its terminal state intact.`,
        );
        continue;
      }
      const message = decision.error.message;
      try {
        await recordJobFailure(job, message, decision.status === "queued");
      } catch (activityError) {
        console.error(
          "Could not record task interruption",
          activityError instanceof Error
            ? activityError.message
            : "Activity publication failed",
        );
      }
      const settled = await checked(
        db().rpc("settle_job_failure", {
          org: job.organization_id,
          job: job.id,
          worker,
          next_status: decision.status,
          message,
          failure_code: decision.error.code,
          provider_name: decision.error.provider ?? null,
          eligible_at: decision.availableAt,
          restore_attempt: decision.restoreAttempt,
        }),
      );
      if (!settled)
        console.info(`Job ${job.id}: failure ignored after ownership ended.`);
      console.error(`Job ${job.id}: ${message}`);
    } finally {
      clearInterval(heartbeat);
      currentJob = null;
      await reportHeartbeat();
    }
  } catch (e) {
    console.error(
      "Worker loop error:",
      e instanceof Error ? e.message : "unknown",
    );
    await new Promise((r) => setTimeout(r, 5000));
  }
}
clearInterval(healthTimer);
await reportHeartbeat("stopped");
console.info("Scout worker stopped");
