# Architecture and implementation boundaries

## Runtime

React + TypeScript + Tailwind + Radix/shadcn-style UI → same-origin Express API → Supabase Auth, PostgreSQL and private Storage. A separate Node worker polls a PostgreSQL queue. Vite serves the frontend in development; Express serves the built SPA in production. There is no browser-side service-role key.

## Pipeline

Discovery (Tavily, Store Leads or Brave Search) → canonical-domain upsert → Shopify and public activity verification → mobile and desktop PSI screening → qualify on any configured technical threshold → repeat qualifying tests to three samples per strategy → bounded public page audit → optional guarded browser diagnostics and historical availability → optional evidence-constrained AI analysis → conservative scoring → private PDF → lead.

Provider and browser failures are surfaced. Partially collected evidence stays attached to an incomplete audit; a completed report is only published after the pipeline succeeds. Non-qualifying candidates are retained without a deep-audit report. All external provider calls reserve daily budget units atomically. Budgets are request counts, not currency estimates.

## Persistence and isolation

Every organization-owned table has an organization ID and RLS. Read access is available to organization members. Sensitive writes go through the authenticated API, which resolves membership and restricts configuration to owners/admins. Tenant-bearing references use composite foreign keys. Authenticated users can only create an organization through a narrow transactional RPC; its creator becomes owner. Service-role credentials exist only in API/worker processes.

## Queue

The worker transactionally materializes due schedules, then claims one due job using SKIP LOCKED. Jobs have leases, progress, attempts, start/end timestamps and errors. A heartbeat renews ownership. Expired leases become retryable; jobs over the attempt limit fail. A unique partial index prevents simultaneous queued/running audit jobs for a domain within an organization. Schedules advance at enqueue time, independent of individual job success. Recurring runs are driven by the always-on worker, not browser timers.

## Network boundary

Only HTTP(S), ports 80/443, public DNS addresses, and credential-free targets are accepted. Each redirect is revalidated. DNS is pinned to a validated public address for the connection. Response sizes, timeouts, redirect counts and page counts are bounded. Robots rules are fetched before storefront resources; failures deny crawling. Browser requests are fulfilled through the same guarded fetcher, limit to GET/HEAD, and honor per-origin robots rules. Browser interaction never clicks, fills, submits or checks out.

## Evidence and limitations

PSI lab results store raw diagnostics, strategy, timestamp and individual scores; medians are only presented after three comparable successful samples. CrUX availability and page/origin scope are explicit. INP comes only from field data. Public HTML heuristics are labeled as observations or hypotheses, never private theme audits. Country is supported by provider provenance or explicit structured-data addressCountry; domain extensions never establish location.

The MVP includes authentication, tenant database, provider discovery, verification, PSI, storage, conservative priority scoring, leads, reports and persistent scheduled jobs. Additional modules implement bounded SEO/HTML/image metadata, visible marketing-tech detection, read-only browser screenshots and diagnostics, historical snapshot metadata, and opt-in grounded AI recommendations. Historical pixel comparison, full link crawling, private CRM audits, verified Google indexing and actual conversion measurement are outside this implementation. The UI labels unobserved information unknown.

## Deployment

Deploy the API/SPA container and worker container on infrastructure supporting always-on processes. Supabase remains the database/auth/storage provider. No deployment or external provisioning is performed without project credentials. See README for exact commands.

## Lead workspace upgrade

Migrations 005/006 add original-name-preserving profile fields, industry provenance/manual overrides, tenant-scoped worker heartbeats, pending country reviews, query-outcome records and atomic category budget counters. The privileged `lead_search_index` is readable only by the service role; the authenticated API always filters its organization ID before sorting, counting or paging. Member clients retain RLS-protected reads of ordinary workspace tables and cannot call import/queue RPCs directly.

Technical opportunity ranking is independent of outreach permission. Pure shared presentation helpers drive grouped findings and readable client summaries; raw diagnostics are React-escaped text in closed disclosures. Original diagnostic excerpts remain traceable by finding ID. Supabase retains full structured metrics separately.

`enqueue_first_audit` locks the store and checks suppression plus all retained audit/job history before inserting a first audit, so repeated import submissions cannot restart completed research. Discovery child enqueueing retains cancellation/lease fencing and records its source search ID. Explicit re-audits preserve the latest audit configuration instead of adopting an unrelated campaign.

Category request limits and the shared total are checked in the same locked reservation update. Daily accounting uses UTC. Worker heartbeats are independent of job lease renewal and identify the process; the container health probe checks that process's heartbeat file/ID. A stopped or disconnected worker is shown as unavailable rather than implying background progress.

## Automation reliability

Migration 007 adds service-only provider pauses and job checkpoints, an explicit blocked state, queue-reason and summary RPCs, and immutable first-seen timestamps for future stores. Legacy timestamps/counts are not fabricated. Failure settlement and checkpoint writes lock the running job and verify its current worker lease; cancellation remains terminal. Provider pause checks wrap the existing atomic request reservation, retaining shared/category cap checks.

Audits take claim priority. New discovery waits at the workspace audit backlog threshold, while an already-running discovery may finish its batch. Scheduled run caps are per campaign per UTC day. Schedules advance from their saved cadence and skip missed intervals. Budget waits do not consume attempts; a deliberate cap increase can release eligible work earlier. Temporary failures retry with jitter and retained Retry-After, while credential/crawl failures require attention.

Successful PageSpeed measurements are checkpointed by organization/job/device/sample with a URL/config signature. Retries reuse valid saved samples for up to 24 hours with original timestamps; other crawl/report steps can repeat. External requests and checkpoint persistence are separate transactions, so an interruption between them can still consume a repeated request. Expired temporary checkpoints are purged hourly.

The authenticated operations API reports current worker health, waiting reasons, provider pauses, schedules, usage and UTC-day outcomes. Philippine-time formatting explicitly labels eligibility and the 08:00 counter reset. Mac login startup/crash recovery uses a user LaunchAgent with absolute paths and no embedded secrets; see MAC_WORKER.md. The Mac must remain logged in, awake and online.

## Saved discovery coverage

Migration 008 introduces a service-only candidate pool and rejection cache for saved Tavily campaigns. Search responses, candidates and cursor advancement commit atomically under the parent worker lease. Claims lock candidate rows and settlement verifies current parent ownership; parent child-job history enforces per-run store limits across restarts. Eligible saved candidates are checked before reserving another search request. Provider exclusions are capped at 150 and never substitute for retained research/suppression checks.

Six query formats explore phrases and regional hints. Every fourth adaptive search may exploit publication/contact yield; pending audits are not treated as successful publications. An audit completion trigger attaches the concrete audit ID to its owning job, and the private outcomes view joins the report for that audit. Legacy attribution is backfilled only for an unambiguous execution-window match. The API scopes the outcomes view and pool RPC to the authenticated workspace and selected campaign. See DISCOVERY_SEARCH.md for cooldowns, estimates, limits and crash-window limitations.

Migration 009 recovers candidate checks whose parent is cancelled or expired and prevents their display as indefinitely active checks. Current parent ownership remains required for settlement.

## Research activity presentation

The worker records bounded structured activity in the existing job JSON payload; no schema change is required. Publications are fenced by organization, job, current worker, running status and unexpired lease. URLs omit credentials, queries and fragments; event messages/facts are bounded and original audit evidence remains in its existing normalized tables. Terminal report publication remains atomic through finalize_audit; the UI derives completion from the saved job/report state rather than recording success before publication.

The private run-detail API validates job/store/audit ownership and returns bounded retained evidence. The selected-run component polls independently of the history snapshot and stops polling terminal runs. Source metadata enriches run labels without exposing credentials. A separately loaded browser-only preview player produces explicitly fictional, non-persisted states and makes no provider calls. See RESEARCH_WORKSPACE.md.
