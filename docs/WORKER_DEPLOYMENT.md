# Always-on worker on an existing server

The worker uses Supabase for its durable queue and heartbeat. The dashboard can close while the worker continues. This setup uses your existing server; it does not provision hosting or buy a plan.

1. Apply migrations through `009_candidate_recovery.sql` before starting the updated app and worker. For the current Mac setup, see [MAC_WORKER.md](MAC_WORKER.md).
2. Copy the repository to the server using your existing authenticated deployment process. Keep `.env` outside Git. Install Docker Engine and the Compose plugin if they are not already available.
3. Create a server-only `.env` containing `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `TAVILY_API_KEY`, `PAGESPEED_API_KEY`, and any optional provider credentials you use. Do not put secret keys in `VITE_` variables. Use a separate protected file for these credentials, readable by the deployment user only.
4. From the project directory run `docker compose -f compose.worker.yaml up -d --build`. No inbound port is required for the worker.
5. Read startup output using `docker compose -f compose.worker.yaml logs --tail=50 scout-worker`. Confirm “connected to Supabase” and “Job processing enabled”. The dashboard's Jobs and Settings screens should show a recent heartbeat within 90 seconds.
6. Stop the local worker after the server heartbeat is confirmed. Keep one worker replica until distributed domain crawl pacing is implemented.

Docker's `restart: unless-stopped` restarts the worker after a process exit or server reboot when Docker starts on boot. A health check reports a stale worker; Docker Compose alone does not restart a merely unhealthy container, so connect your existing server monitor to container health or supervise it through your host's normal tooling. Availability still depends on that server and its network.

For updates, run the same `up -d --build` command. Shutdown allows 15 minutes for an active audit to finish. A forced interruption leaves a leased job recoverable after expiry; partial provider calls may already count toward usage.

Use `docker compose -f compose.worker.yaml stop` to stop processing gracefully. Queued jobs remain in Supabase. Stop discovery in the dashboard separately if scheduled discovery should also be disabled.

Separate discovery/audit request caps and the shared total are configured in Settings and reset at midnight UTC. Budget-blocked work is deferred to the next UTC day without exhausting its retry allowance. Provider quotas remain separate from these app limits.

Deployment is not complete until a heartbeat from the actual server is verified. Server identity/access is required; never paste credentials into chat.
