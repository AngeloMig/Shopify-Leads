import {
  mkdir,
  readFile,
  writeFile,
  chmod,
  unlink,
  copyFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const label = "com.scout.shopify-leads.worker";
const home = homedir(),
  root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plist = resolve(home, "Library/LaunchAgents", `${label}.plist`);
const logs = resolve(home, "Library/Logs/Scout");
const domain = `gui/${process.getuid!()}`,
  target = `${domain}/${label}`;
if (process.platform !== "darwin")
  throw new Error("The Mac worker service requires macOS.");
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const run = (args: string[], optional = false) => {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8" });
  if (result.status && !optional)
    throw new Error(result.stderr.trim() || `launchctl ${args[0]} failed`);
  return result;
};
const installed = () => run(["print", target], true).status === 0;
const action = process.argv[2] ?? "status";
const launchPaused = process.argv.includes("--paused");
if (action === "status") {
  const r = run(["print", target], true);
  if (r.status) console.info("Scout automatic worker is not loaded.");
  else
    console.info(
      r.stdout
        .split("\n")
        .filter((s) => /state =|pid =|runs =|last exit code =/.test(s))
        .map((s) => s.trim())
        .join("\n"),
    );
  console.info(`Logs: ${logs}`);
} else if (action === "install") {
  if (installed())
    throw new Error(
      "The service is already loaded. Stop it gracefully before updating its installation.",
    );
  await readFile(resolve(root, ".env")); // Verify it exists; never copy secrets into the plist.
  if (!installed()) {
    const ps = spawnSync("/bin/ps", ["-axo", "pid,args"], {
      encoding: "utf8",
    }).stdout;
    const others = ps
      .split("\n")
      .filter((s) => /\bserver\/worker\.ts(?:\s|$)/.test(s));
    if (others.length)
      throw new Error(
        "A manual Scout worker is still running. Let it stop gracefully before installing the service.",
      );
  }
  await mkdir(dirname(plist), { recursive: true });
  await mkdir(logs, { recursive: true, mode: 0o700 });
  await chmod(logs, 0o700);
  for (const name of ["worker.stdout.log", "worker.stderr.log"]) {
    const file = resolve(logs, name);
    await writeFile(file, "", { flag: "a", mode: 0o600 });
    await chmod(file, 0o600);
  }
  try {
    await copyFile(plist, `${plist}.previous`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const node = process.execPath;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(node)}</string><string>--import</string><string>tsx</string><string>server/worker.ts</string></array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(dirname(node))}:/usr/bin:/bin:/usr/sbin:/sbin</string>${launchPaused ? "<key>WORKER_PAUSED</key><string>true</string>" : ""}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer><key>ExitTimeOut</key><integer>900</integer>
<key>StandardOutPath</key><string>${escape(resolve(logs, "worker.stdout.log"))}</string>
<key>StandardErrorPath</key><string>${escape(resolve(logs, "worker.stderr.log"))}</string>
</dict></plist>`;
  await writeFile(plist, xml, { mode: 0o600 });
  await chmod(plist, 0o600);
  const lint = spawnSync("/usr/bin/plutil", ["-lint", plist], {
    encoding: "utf8",
  });
  if (lint.status) throw new Error(lint.stdout || lint.stderr);
  if (installed())
    throw new Error(
      "The service is already loaded. Use stop, wait for the worker to finish, then install to update its paths.",
    );
  run(["enable", target]);
  run(["bootstrap", domain, plist]);
  console.info(
    "Scout worker installed: starts at login and restarts after exit.",
  );
  console.info(`Service: ${label}\nLogs: ${logs}`);
} else if (action === "stop") {
  run(["bootout", target]);
  console.info(
    "Automatic worker unloaded. An active job is allowed to finish before exit. Queued work is retained.",
  );
} else if (action === "start") {
  run(["enable", target]);
  run(["bootstrap", domain, plist]);
  console.info("Scout automatic worker started.");
} else if (action === "restart") {
  run(["kill", "SIGTERM", target]);
  console.info(
    "Graceful restart requested. launchd will relaunch the worker after its current job finishes.",
  );
} else if (action === "uninstall") {
  if (installed()) run(["bootout", target]);
  await unlink(plist).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  console.info(
    "Scout startup service removed. Logs and queued work are retained.",
  );
} else
  throw new Error("Use install, status, start, stop, restart or uninstall.");
