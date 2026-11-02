import { db, checked, now } from "../lib/db.js";
import { CrawlSession, normalizeDomain } from "../lib/network.js";
import { discoveryHistory } from "../lib/discovery-history.js";
import { JobError } from "../lib/job-errors.js";
import { discover, type Charge, type Candidate } from "./providers.js";
import { inspectStorefront } from "./storefront.js";
import { classifyIndustry } from "../../shared/lead-intelligence.js";
import {
  rejectionPolicy,
  type QueryOutcome,
} from "../../shared/discovery-search.js";
import type {
  Job,
  DiscoverySettings,
  DiscoveryFunnel,
} from "../../shared/types.js";
import type { ActivityEmitter } from "../lib/job-activity.js";

type OwnedJob = Job & { organization_id: string; worker_id: string };
export async function savedDiscovery(
  job: OwnedJob,
  config: DiscoverySettings,
  cursor: string | null,
  charge: Charge,
  ownership: () => Promise<void>,
  outcome: (message: string, details: Record<string, unknown>) => Promise<void>,
  progress: (n: number) => Promise<void>,
  emit: ActivityEmitter = async () => {},
) {
  const org = job.organization_id,
    campaign = String(job.payload.query_id);
  const scope = JSON.stringify([...config.countries].sort());
  const [events, children, history] = await Promise.all([
    checked(
      db()
        .from("discovery_searches")
        .select("*")
        .eq("organization_id", org)
        .eq("job_id", job.id)
        .order("sequence"),
    ),
    checked(
      db()
        .from("automation_jobs")
        .select("id")
        .eq("organization_id", org)
        .eq("type", "audit")
        .contains("payload", { parent_job_id: job.id }),
    ),
    checked(
      db()
        .from("discovery_search_outcomes")
        .select("*")
        .eq("organization_id", org)
        .eq("query_id", campaign)
        .order("created_at", { ascending: false })
        .limit(1000),
    ),
  ]);
  const previous = job.payload.funnel as DiscoveryFunnel | undefined;
  const currentSearchIds = new Set(events.map((e: any) => e.id));
  const funnel: DiscoveryFunnel = {
    search_limit: config.searches_per_run ?? 1,
    searches: events.map((e: any) => ({
      query: e.query,
      keyword: e.keyword,
      country: e.country,
      industry: e.industry,
      format: e.format,
      credits: e.credits,
      credits_measured: e.credits_measured,
      returned: e.returned,
      duplicates: e.duplicate_results,
      candidates: 0,
      excluded: 0,
      invalid: 0,
    })),
    returned: events.reduce((n: number, e: any) => n + e.returned, 0),
    candidates: previous?.candidates ?? 0,
    checked: previous?.checked ?? 0,
    shopify: previous?.shopify ?? 0,
    active: previous?.active ?? 0,
    country: previous?.country ?? 0,
    queued: children.length,
    previously_researched: previous?.previously_researched ?? 0,
    suppressed: previous?.suppressed ?? 0,
    rejections: previous?.rejections ?? [],
    saved_used: previous?.saved_used ?? 0,
  };
  let searches = job.api_usage?.tavily ?? 0,
    checks = 0;
  const crawl = new CrawlSession();
  const save = async () =>
    outcome(
      `${funnel.queued} verified storefronts queued for audit. ${funnel.saved_used ?? 0} saved candidates checked; ${searches} search request(s) used. ${funnel.previously_researched} previously researched skipped.`,
      { funnel },
    );
  while (funnel.queued < config.batch_size && checks < 60) {
    await ownership();
    const rows = await checked(
      db().rpc("claim_discovery_candidate", {
        org,
        job: job.id,
        worker: job.worker_id,
        campaign,
        scope_value: scope,
      }),
    );
    const item = rows[0];
    if (!item) {
      if (searches >= funnel.search_limit) break;
      const excluded = await checked(
        db().rpc("discovery_exclusions", { org, scope_value: scope }),
      );
      const result = await discover(config, charge, cursor, [], {
        processed: excluded.map((r: any) => r.domain),
        outcomes: history as QueryOutcome[],
        onQuery: async (plan) =>
          emit("search", "started", `Searching for ${plan.keyword}`, {
            task: {
              key: `search:${searches + 1}`,
              name: `Search ${searches + 1}: ${plan.keyword}`,
              state: "waiting",
            },
            facts: {
              query: plan.query,
              country: plan.country,
              format: plan.format,
            },
          }),
      });
      searches++;
      if (!result.summary) throw new Error("Missing search summary");
      await ownership();
      const eventId = await checked(
        db().rpc("save_discovery_batch", {
          org,
          job: job.id,
          worker: job.worker_id,
          campaign,
          sequence_no: searches,
          summary: result.summary,
          cursor_value: result.nextCursor,
          items: result.candidates,
        }),
      );
      currentSearchIds.add(eventId);
      await emit(
        "search",
        "completed",
        `${result.candidates.length} candidate stores saved from ${result.summary.returned} search results`,
        {
          task: {
            key: `search:${searches}`,
            name: `Search ${searches}`,
            state: "completed",
          },
          facts: {
            returned: result.summary.returned,
            candidates: result.candidates.length,
          },
        },
      );
      cursor = result.nextCursor;
      funnel.searches.push(result.summary);
      funnel.returned += result.summary.returned;
      funnel.candidates += result.candidates.length;
      await save();
      continue;
    }
    checks++;
    if (!currentSearchIds.has(item.search_id)) {
      funnel.saved_used = (funnel.saved_used ?? 0) + 1;
      funnel.candidates++;
    }
    const c = item.candidate as Candidate;
    await emit("verify", "started", `Checking ${c.domain}`, {
      url: `https://${c.domain}/`,
      target: {
        label: config.name,
        domain: c.domain,
        url: `https://${c.domain}/`,
      },
    });
    const settle = async (
      status: string,
      message: string,
      code = "",
      global = false,
      retryAt = now(),
    ) => {
      await checked(
        db().rpc("settle_discovery_candidate", {
          org,
          job: job.id,
          worker: job.worker_id,
          item_id: item.id,
          next_status: status,
          message,
          code_value: code,
          scope_value: global ? "*" : scope,
          retry_at_value: retryAt,
        }),
      );
      await emit("verify", "note", `${c.domain}: ${message}`, {
        url: `https://${c.domain}/`,
        facts: { outcome: status },
        task: {
          key: `store:${c.domain}`,
          name: `Verify ${c.domain}`,
          state: ["queued", "researched"].includes(status)
            ? "completed"
            : "skipped",
        },
      });
    };
    const reject = async (message: string) => {
      const p = rejectionPolicy(message);
      await settle("rejected", message, p.code, p.global, p.retryAt);
      funnel.rejections.push(`${c.domain}: ${message}`);
      await emit("verify", "note", `Set aside ${c.domain}: ${message}`, {
        url: `https://${c.domain}/`,
        facts: { outcome: "rejected", retry_at: p.retryAt },
      });
    };
    const seen = await discoveryHistory(org, c.domain);
    if (seen?.seen) {
      funnel.previously_researched++;
      await settle("researched", "Already researched");
      await emit(
        "verify",
        "note",
        `Skipped ${c.domain}; already in your research history`,
        { facts: { outcome: "duplicate" } },
      );
      await save();
      continue;
    }
    const suppressed = await checked(
      db()
        .from("suppression_list")
        .select("id")
        .eq("organization_id", org)
        .eq("domain", c.domain)
        .limit(1),
    );
    if (suppressed.length) {
      funnel.suppressed++;
      await settle("suppressed", "Domain suppressed");
      await save();
      continue;
    }
    funnel.checked++;
    let screen;
    try {
      screen = await inspectStorefront(
        c.domain,
        config,
        crawl,
        c,
        ownership,
        emit,
      );
    } catch (error) {
      await ownership();
      await reject(
        error instanceof Error ? error.message : "Storefront unavailable",
      );
      await save();
      continue;
    }
    if (screen.verified) funnel.shopify++;
    if (screen.verified && screen.activity >= 50) funnel.active++;
    if (
      screen.verified &&
      screen.activity >= 50 &&
      screen.country &&
      config.countries.includes(screen.country)
    )
      funnel.country++;
    if (screen.reason) {
      if (screen.verified && screen.activity >= 50 && !screen.country) {
        await checked(
          db()
            .from("candidate_reviews")
            .upsert(
              {
                organization_id: org,
                query_id: campaign,
                domain: normalizeDomain(screen.home.url),
                name: screen.homepage.title || c.name,
                source_url: c.source_url,
                reason:
                  "Active Shopify store; business country could not be verified from the pages checked.",
                metadata: {
                  activity: screen.activity,
                  homepage: screen.homepage,
                },
              },
              { onConflict: "organization_id,domain", ignoreDuplicates: true },
            ),
        );
        await settle("review", screen.reason);
        await emit("verify", "note", `${c.domain} needs country review`, {
          facts: { outcome: "review" },
        });
      } else await reject(screen.reason);
      await save();
      continue;
    }
    if (screen.fitReason) {
      funnel.outside_fit = (funnel.outside_fit ?? 0) + 1;
      await reject(screen.fitReason);
      await save();
      continue;
    }
    const canonical = normalizeDomain(screen.home.url);
    const canonicalSeen =
      canonical === c.domain ? seen : await discoveryHistory(org, canonical);
    if (canonicalSeen?.seen) {
      funnel.previously_researched++;
      await settle("researched", "Canonical domain already researched");
      await save();
      continue;
    }
    const canonicalSuppressed = await checked(
      db()
        .from("suppression_list")
        .select("id")
        .eq("organization_id", org)
        .eq("domain", canonical)
        .limit(1),
    );
    if (canonicalSuppressed.length) {
      funnel.suppressed++;
      await settle("suppressed", "Canonical domain suppressed");
      await save();
      continue;
    }
    const {
      priority: _priority,
      search_country: _country,
      search_industry: _industry,
      ...source
    } = c;
    const store = canonicalSeen
      ? { id: canonicalSeen.store_id }
      : await checked(
          db()
            .from("discovered_stores")
            .upsert(
              {
                ...source,
                domain: canonical,
                name: screen.homepage.title || c.name,
                country: screen.country,
                country_evidence: screen.country_evidence,
                shopify_verified: true,
                activity: screen.activity,
                ...classifyIndustry([screen.homepage]),
                researched_at: now(),
                organization_id: org,
              },
              { onConflict: "organization_id,domain" },
            )
            .select("id")
            .single(),
        );
    await checked(
      db().rpc("enqueue_discovered_audit", {
        org,
        parent: job.id,
        worker: job.worker_id,
        store: store.id,
        config: { ...config, _search_id: item.search_id },
      }),
    );
    await emit(
      "queue",
      "note",
      `${canonical} passed verification and was queued for audit`,
      {
        url: `https://${canonical}/`,
        facts: { outcome: "queued", country: screen.country ?? "Unverified" },
      },
    );
    await settle("queued", "Verified storefront queued for audit");
    funnel.queued++;
    await save();
    await progress(
      Math.min(95, 10 + Math.round((funnel.queued / config.batch_size) * 85)),
    );
  }
  if (
    searches >= funnel.search_limit &&
    !events.length &&
    !funnel.searches.length &&
    !checks
  )
    throw new JobError(
      "This run used its search request allowance before a successful response. Start a new discovery run after resolving the provider issue.",
      "search_limit",
      "tavily",
    );
  await ownership();
  if (!searches)
    await emit(
      "search",
      "skipped",
      "Used saved candidates; no new search request was needed",
    );
  await emit(
    "verify",
    "completed",
    `Store checks finished: ${funnel.checked} checked in this run`,
    {
      facts: {
        checked: funnel.checked,
        shopify: funnel.shopify,
        country: funnel.country,
      },
    },
  );
  await emit(
    "queue",
    "completed",
    `${funnel.queued} verified stores queued for audit`,
    {
      facts: {
        queued: funnel.queued,
        saved: funnel.saved_used ?? 0,
        search_requests: searches,
      },
    },
  );
  await save();
}
