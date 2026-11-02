import { readFile } from "node:fs/promises";
import { db, checked } from "./lib/db.js";
const worker = await readFile(
  process.env.SCOUT_WORKER_ID_FILE || "/tmp/scout-worker-id",
  "utf8",
);
const rows = await checked(
  db()
    .from("worker_heartbeats")
    .select("last_seen,state")
    .eq("worker_id", worker.trim())
    .gt("last_seen", new Date(Date.now() - 90000).toISOString())
    .in("state", ["idle", "working", "paused"])
    .limit(1),
);
if (!rows.length) {
  console.error("No recent Scout worker heartbeat.");
  process.exitCode = 1;
} else console.info("Recent Scout worker heartbeat confirmed.");
