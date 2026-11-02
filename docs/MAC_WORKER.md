# Automatic worker on this Mac

Apply migrations through `009_candidate_recovery.sql` before using this worker. Keep the repository in its installed location and configure the existing server-only `.env`. Never paste secrets into a plist or frontend variables.

```sh
npm run mac:worker -- install
npm run mac:worker -- status
npm run check:worker
```

Installation creates `~/Library/LaunchAgents/com.scout.shopify-leads.worker.plist`, loads it for the current user and starts the worker immediately. It starts again at login and launchd restarts it after an exit or crash. The plist uses absolute Node and repository paths and reads credentials from the project's existing `.env`. Moving the project or removing that Node version requires stopping and reinstalling the service.

Logs are `~/Library/Logs/Scout/worker.stdout.log` and `worker.stderr.log`. The Jobs screen shows a heartbeat within 90 seconds, daily request counters, queue reasons and schedules. Use one worker instance; stop any manual `npm run worker` before installing.

```sh
npm run mac:worker -- restart
npm run mac:worker -- stop
npm run mac:worker -- start
npm run mac:worker -- uninstall
```

Restart requests a graceful exit after the current job; launchd then starts a replacement. Stop unloads automatic processing and permits the current job to drain (up to the service's 15-minute shutdown allowance). Start loads the installed service again. Uninstall removes startup configuration; logs and queued research remain. Stop discovery in the dashboard separately to disable discovery schedules. Do not use `kill -9` on a working audit as a normal restart procedure.

For a no-provider deployment check, install with `npm run mac:worker -- install --paused`. This starts heartbeats but does not claim jobs, schedule discovery or run cleanup. Stop it, wait for the process to exit, then reinstall without `--paused` to enable processing. Paused mode is saved in that installation's plist; `start` alone does not remove it.

The Mac must be logged in, awake and online. Closing the dashboard is fine; sleeping, shutting down or logging out stops processing. Missed discovery intervals are skipped rather than queued in a burst. Netlify or another frontend host is unnecessary for local use and would not keep this Mac worker awake.

## Queue and request controls

- Scheduled campaigns have a per-campaign daily run cap. The configured Australian skincare campaign targets up to three verified stores with one Tavily search per run, once daily at 08:00 Philippine time. Fewer stores can qualify. Existing broad campaigns stay disabled.
- New discovery waits when queued/running audits reach the configured backlog threshold (five initially). An active discovery may finish its batch. Audits are claimed before discovery jobs.
- Discovery and audit request caps remain under the shared total. A request is counted when reserved, including failed requests. Counters reset at midnight UTC, 08:00 Philippine time. Provider billing/credits may differ from app request counts.
- Temporary failures retry with exponential delay and jitter; HTTP rate limits retain `Retry-After`. Invalid provider credentials pause that provider for the workspace; correct the server configuration and use Resume provider. Robots/crawl restrictions need review and are never bypassed. Resume job retries the existing job; a discovery that exhausted its search allowance needs an explicit new run.
- Successful PageSpeed samples saved for the same job, URL, device and sample can be reused for 24 hours. Original test times remain visible. Ownership and cancellation are checked before reading/requesting/saving. Other pipeline steps may run again. A crash between an external response and checkpoint persistence may still repeat that request.
- Fresh and restored Lighthouse environments are compared by named fields, so database JSON key ordering cannot block a resumed audit. Real URL or environment changes still stop publication of a mixed median.
- Resume shows its own Resuming state, switches out of terminal-only filters and opens the selected run in the research workspace. A successful requeue can wait behind the current audit, budgets or a provider pause; those reasons remain visible.
- A stale, denied, non-HTML or robots-disallowed secondary product/contact/about/collection page is recorded as a coverage limitation. The worker tries up to two published links per page type and continues accessible pages. The homepage remains required; rate limits, server outages and lost ownership still propagate. Reports disclose skipped pages and do not infer findings for them.
- Summary store/duplicate instrumentation begins with migration 007. Historical missing counts remain unrecorded. Published-audit and new-lead counts use retained timestamps; public email publication does not establish mailbox deliverability or outreach permission.

For a later move to an existing always-on server, follow [WORKER_DEPLOYMENT.md](WORKER_DEPLOYMENT.md) and stop the Mac worker after verifying the replacement heartbeat.
