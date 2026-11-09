import { randomUUID } from "node:crypto";
import { db, checked, insert, now } from "./lib/db.js";
import { CrawlSession, normalizeDomain, providerJson } from "./lib/network.js";
import {
  discover,
  pageSpeed,
  type Charge,
  type PsiSample,
} from "./modules/providers.js";
import { inspectHtml } from "./modules/html-audit.js";
import { inspectStorefront } from "./modules/storefront.js";
import {
  classifyIndustry,
  shortBusinessName,
  hasFrontendOpportunity,
} from "../shared/lead-intelligence.js";
import { savePublicEmails } from "./lib/contacts.js";
import { checkMailDomains } from "./lib/mail-domain.js";
import { scanContactPages } from "./modules/contact-audit.js";
import { scanRepresentativePages } from "./modules/representative-pages.js";
import { lighthouseIdentity } from "../shared/audit-presentation.js";
import { checkpointedPageSpeed } from "./lib/checkpoints.js";
import { JobError } from "./lib/job-errors.js";
import { savedDiscovery } from "./modules/saved-discovery.js";
import {
  localDiscovery,
  type LocalSearchConfig,
} from "./modules/local-discovery.js";
import { jobActivity, publishJobWork } from "./lib/job-activity.js";
import { discoveryHistory } from "./lib/discovery-history.js";
import { inspectBrowser } from "./modules/browser.js";
import { recommend } from "./modules/ai.js";
import { readSender } from "../shared/sender.js";
import { createReport, reportVersion, reportAgency } from "./modules/report.js";
import { median, qualifies } from "../shared/scoring.js";
import { detectTiming, leadScore } from "../shared/lead-score.js";
import {
  defaultSettings,
  productSpeedOf,
  type ProductSpeed,
  type DiscoverySettings,
  type DiscoveryFunnel,
  type Finding,
  type Job,
} from "../shared/types.js";
export async function enqueue(
  organization_id: string,
  type: "discovery" | "audit",
  key: string,
  payload: Record<string, unknown>,
) {
  const result = await db()
    .from("automation_jobs")
    .insert({ organization_id, type, dedupe_key: key, payload })
    .select()
    .single();
  if (result.error?.code === "23505") return null;
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
export async function executeJob(
  job: Job & { organization_id: string; worker_id: string },
) {
  const org = job.organization_id;
  const progress = async (p: number) => {
    await ensureOwnership();
    await checked(
      db()
        .from("automation_jobs")
        .update({ progress: p })
        .eq("id", job.id)
        .eq("worker_id", job.worker_id)
        .eq("status", "running"),
    );
  };
  let config: DiscoverySettings = defaultSettings;
  let sourceCursor: string | null = null;
  if (job.payload.query_id) {
    const q = await checked(
      db()
        .from("discovery_queries")
        .select("config,source_cursor")
        .eq("id", job.payload.query_id)
        .eq("organization_id", org)
        .single(),
    );
    config = q.config;
    sourceCursor = q.source_cursor;
  } else if (job.payload.config)
    config = job.payload.config as DiscoverySettings;
  const ensureOwnership = async () => {
    const owned = await checked(
      db()
        .from("automation_jobs")
        .select("id")
        .eq("id", job.id)
        .eq("organization_id", org)
        .eq("worker_id", job.worker_id)
        .eq("status", "running")
        .gt("lease_until", now())
        .maybeSingle(),
    );
    if (!owned) throw new Error("Worker lease lost");
  };
  const charge: Charge = async (provider) => {
    await ensureOwnership();
    await checked(
      db().rpc("reserve_api_unit", {
        org,
        job: job.id,
        provider,
        budget: config.daily_api_budget,
      }),
    );
  };
  let payload = { ...job.payload };
  const outcome = async (
    result: string,
    details: Record<string, unknown> = {},
  ) => {
    payload = { ...payload, ...details, result };
    await checked(
      db()
        .from("automation_jobs")
        .update({ payload })
        .eq("id", job.id)
        .eq("worker_id", job.worker_id)
        .eq("status", "running"),
    );
  };
  const emit = jobActivity(job, async (work) => {
    const next = { ...payload, work };
    await publishJobWork(job, next);
    payload = next;
  });
  await ensureOwnership();
  const initialStage = job.type === "audit" ? "verify" : "prepare";
  await emit(
    initialStage,
    "started",
    "Loading the saved research configuration",
    {
      target: { label: config.name },
      task: {
        key: "config",
        name: "Load research configuration",
        state: "starting",
      },
    },
  );
  await emit(
    initialStage,
    "completed",
    "Configuration loaded; request limits remain in force",
    {
      task: {
        key: "config",
        name: "Load research configuration",
        state: "completed",
      },
    },
  );
  if (job.type === "discovery") {
    if (job.payload.kind === "local") {
      await localDiscovery(
        org,
        job.payload.config as LocalSearchConfig,
        charge,
        outcome,
        progress,
        emit,
        job.payload,
      );
      return;
    }
    if (config.provider === "tavily" && job.payload.query_id) {
      await savedDiscovery(
        job,
        config,
        sourceCursor,
        charge,
        ensureOwnership,
        outcome,
        progress,
        emit,
      );
      return;
    }
    const searchLimit =
      config.provider === "tavily" ? (config.searches_per_run ?? 1) : 1;
    const previous = job.payload.funnel as DiscoveryFunnel | undefined;
    const funnel: DiscoveryFunnel =
      previous &&
      Array.isArray(previous.searches) &&
      Array.isArray(previous.rejections)
        ? { ...previous, search_limit: searchLimit }
        : {
            search_limit: searchLimit,
            searches: [],
            returned: 0,
            candidates: 0,
            checked: 0,
            shopify: 0,
            active: 0,
            country: 0,
            queued: 0,
            previously_researched: 0,
            suppressed: 0,
            rejections: [],
          };
    let selected = funnel.queued;
    let previouslyResearched = funnel.previously_researched;
    const rejected = funnel.rejections;
    const crawl = new CrawlSession();
    let searchEvent: {
      id: string;
      checked: number;
      verified: number;
      queued: number;
      previously_researched: number;
      rejected: number;
    } | null = null;
    const feedback =
      config.adaptive_queries === false
        ? []
        : await checked(
            db()
              .from("discovery_searches")
              .select("country,industry,keyword,queued")
              .eq("organization_id", org)
              .eq("query_id", job.payload.query_id)
              .eq("completed", true)
              .order("created_at", { ascending: false })
              .limit(250),
          );
    const failures = new Map<
      string,
      {
        country: string;
        industry: string;
        keyword: string;
        count: number;
        productive: boolean;
      }
    >();
    for (const row of feedback) {
      const key = JSON.stringify([row.country, row.industry, row.keyword]);
      const entry = failures.get(key) ?? {
        ...row,
        count: 0,
        productive: false,
      };
      entry.count++;
      entry.productive ||= row.queued > 0;
      failures.set(key, entry);
    }
    const avoid = [...failures.values()].filter(
      (row) => row.count >= 2 && !row.productive,
    );
    const persistFunnel = async () => {
      await ensureOwnership();
      if (searchEvent) {
        const { id, ...counts } = searchEvent;
        await checked(
          db()
            .from("discovery_searches")
            .update(counts)
            .eq("organization_id", org)
            .eq("id", id),
        );
      }
      funnel.previously_researched = previouslyResearched;
      await outcome(
        `${selected} verified storefront${selected === 1 ? "" : "s"} queued for audit. ${previouslyResearched} previously researched skipped. ${rejected.length} rejected.${rejected.length ? ` ${rejected.slice(0, 8).join("; ")}` : ""}`,
        { funnel },
      );
    };
    // API reservations survive retries. Failed provider requests count toward
    // the same per-job cap, as well as the existing daily organization budget.
    const used =
      config.provider === "tavily" ? (job.api_usage?.tavily ?? 0) : 0;
    if (used >= searchLimit && !funnel.searches.length)
      throw new JobError(
        "This run used its search request allowance before a successful response. Start a new discovery run after resolving the provider issue.",
        "search_limit",
        config.provider,
      );
    for (
      let search = used;
      search < searchLimit && selected < config.batch_size;
      search++
    ) {
      await ensureOwnership();
      await emit(
        "search",
        "started",
        `Requesting candidates from ${config.provider}`,
      );
      const { candidates, nextCursor, summary } = await discover(
        config,
        charge,
        sourceCursor,
        avoid,
      );
      await ensureOwnership();
      await emit(
        "search",
        "completed",
        `${candidates.length} candidate websites returned`,
        {
          facts: {
            candidates: candidates.length,
            query: summary?.query ?? config.name,
          },
        },
      );
      sourceCursor = nextCursor;
      if (summary) {
        funnel.searches.push(summary);
        const event = await checked(
          db()
            .from("discovery_searches")
            .upsert(
              {
                organization_id: org,
                job_id: job.id,
                query_id: job.payload.query_id,
                sequence: search + 1,
                query: summary.query,
                keyword: summary.keyword,
                country: summary.country,
                industry: summary.industry,
                returned: summary.returned,
                duplicate_results: summary.duplicates,
                duplicate_results_recorded: true,
              },
              { onConflict: "organization_id,job_id,sequence" },
            )
            .select()
            .single(),
        );
        searchEvent = {
          id: event.id,
          checked: event.checked,
          verified: event.verified,
          queued: event.queued,
          previously_researched: event.previously_researched,
          rejected: event.rejected,
        };
      }
      funnel.returned += summary?.returned ?? candidates.length;
      funnel.candidates += candidates.length;
      // Commit search rotation immediately, before slow merchant verification.
      if (job.payload.query_id)
        await checked(
          db()
            .from("discovery_queries")
            .update({ source_cursor: nextCursor })
            .eq("id", job.payload.query_id)
            .eq("organization_id", org),
        );
      await persistFunnel();
      await progress(
        Math.min(90, 10 + Math.round((search / searchLimit) * 60)),
      );
      for (let i = 0; i < candidates.length; i++) {
        if (selected >= config.batch_size) break;
        await ensureOwnership();
        const c = candidates[i];
        await emit("verify", "started", `Checking ${c.domain}`, {
          url: `https://${c.domain}/`,
          target: {
            label: config.name,
            domain: c.domain,
            url: `https://${c.domain}/`,
          },
        });
        const history = await discoveryHistory(org, c.domain);
        if (history?.seen) {
          previouslyResearched++;
          if (searchEvent) searchEvent.previously_researched++;
          continue;
        }
        const suppression = await checked(
          db()
            .from("suppression_list")
            .select("id")
            .eq("organization_id", org)
            .eq("domain", c.domain),
        );
        if (suppression.length) {
          funnel.suppressed++;
          continue;
        }
        funnel.checked++;
        if (searchEvent) searchEvent.checked++;
        let screen;
        try {
          screen = await inspectStorefront(
            c.domain,
            config,
            crawl,
            c,
            ensureOwnership,
            emit,
          );
        } catch (error) {
          await ensureOwnership();
          rejected.push(
            `${c.domain}: ${error instanceof Error ? error.message : "Storefront unavailable"}`,
          );
          continue;
        }
        if (screen.verified) {
          funnel.shopify++;
          if (searchEvent) searchEvent.verified++;
        }
        if (screen.verified && screen.activity >= 50) funnel.active++;
        if (
          screen.verified &&
          screen.activity >= 50 &&
          screen.country &&
          config.countries.includes(screen.country)
        )
          funnel.country++;
        if (screen.reason) {
          if (searchEvent) searchEvent.rejected++;
          if (screen.verified && screen.activity >= 50 && !screen.country) {
            await checked(
              db()
                .from("candidate_reviews")
                .upsert(
                  {
                    organization_id: org,
                    query_id: job.payload.query_id,
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
                  {
                    onConflict: "organization_id,domain",
                    ignoreDuplicates: true,
                  },
                ),
            );
          }
          rejected.push(`${c.domain}: ${screen.reason}`);
          continue;
        }
        if (screen.fitReason) {
          funnel.outside_fit = (funnel.outside_fit ?? 0) + 1;
          if (searchEvent) searchEvent.rejected++;
          rejected.push(`${c.domain}: ${screen.fitReason}`);
          continue;
        }
        const canonicalDomain = normalizeDomain(screen.home.url);
        const canonicalHistory =
          canonicalDomain === c.domain
            ? history
            : await discoveryHistory(org, canonicalDomain);
        if (canonicalHistory?.seen) {
          previouslyResearched++;
          if (searchEvent) searchEvent.previously_researched++;
          continue;
        }
        const canonicalSuppression = await checked(
          db()
            .from("suppression_list")
            .select("id")
            .eq("organization_id", org)
            .eq("domain", canonicalDomain),
        );
        if (canonicalSuppression.length) {
          funnel.suppressed++;
          continue;
        }
        const {
          priority: _priority,
          search_country: _searchCountry,
          search_industry: _searchIndustry,
          ...candidateSource
        } = c;
        const verifiedCandidate = {
          ...candidateSource,
          domain: canonicalDomain,
          name: screen.homepage.title || c.name,
          country: screen.country,
          country_evidence: screen.country_evidence,
          shopify_verified: true,
          activity: screen.activity,
          ...classifyIndustry([screen.homepage]),
          researched_at: now(),
        };
        const store =
          (canonicalHistory ? { id: canonicalHistory.store_id } : null) ??
          (await checked(
            db()
              .from("discovered_stores")
              .upsert(
                { ...verifiedCandidate, organization_id: org },
                {
                  onConflict: "organization_id,domain",
                  ignoreDuplicates: false,
                },
              )
              .select()
              .single(),
          ));
        await checked(
          db().rpc("enqueue_discovered_audit", {
            org,
            parent: job.id,
            worker: job.worker_id,
            store: store.id,
            config: { ...config, _search_id: searchEvent?.id },
          }),
        );
        await emit(
          "queue",
          "note",
          `${canonicalDomain} passed verification and was queued for audit`,
          { url: `https://${canonicalDomain}/` },
        );
        if (searchEvent) searchEvent.queued++;
        selected++;
        funnel.queued = selected;
        await persistFunnel();
        await progress(
          Math.min(95, 10 + Math.round((selected / config.batch_size) * 85)),
        );
      }
      await persistFunnel();
      if (searchEvent)
        await checked(
          db()
            .from("discovery_searches")
            .update({ completed: true })
            .eq("organization_id", org)
            .eq("id", searchEvent.id),
        );
    }
    await ensureOwnership();
    await emit(
      "verify",
      "completed",
      `Store checks finished: ${funnel.checked} checked`,
    );
    await emit(
      "queue",
      "completed",
      `${funnel.queued} verified stores queued for audit`,
    );
    await persistFunnel();
    return;
  }

  const store = await checked(
    db()
      .from("discovered_stores")
      .select("*")
      .eq("id", job.payload.store_id)
      .eq("organization_id", org)
      .single(),
  );
  await emit(
    "verify",
    "started",
    "Checking the storefront and its public business evidence",
    {
      target: {
        label: store.display_name || store.name,
        domain: store.domain,
        url: `https://${store.domain}/`,
      },
    },
  );
  const suppression = await checked(
    db()
      .from("suppression_list")
      .select("id")
      .eq("organization_id", org)
      .eq("domain", store.domain),
  );
  if (suppression.length)
    throw new Error("Domain is suppressed; audit cancelled.");
  await ensureOwnership();
  const audit = await insert("audit_runs", {
    organization_id: org,
    store_id: store.id,
  });
  await emit("verify", "note", "Audit record opened", {
    target: {
      label: store.display_name || store.name,
      domain: store.domain,
      url: `https://${store.domain}/`,
      audit_id: audit.id,
    },
  });
  const persistFinding = async (f: Finding) => {
    await insert("audit_findings", {
      ...f,
      organization_id: org,
      audit_id: audit.id,
    });
  };
  try {
    const crawl = new CrawlSession();
    const {
      home,
      homepage,
      verified,
      activity,
      country,
      country_evidence,
      catalog,
      fit,
      reason,
    } = await inspectStorefront(
      store.domain,
      config,
      crawl,
      store,
      ensureOwnership,
      emit,
    );
    await checked(
      db()
        .from("discovered_stores")
        .update({
          ...(!store.display_name
            ? {
                display_name: shortBusinessName(
                  homepage.title || store.name,
                  store.domain,
                ),
              }
            : {}),
          shopify_verified: verified,
          activity,
          country,
          country_evidence,
          contact_url:
            homepage.contact_url ??
            (homepage.emails[0] ? `mailto:${homepage.emails[0].email}` : null),
          researched_at: now(),
        })
        .eq("id", store.id)
        .eq("organization_id", org),
    );
    await insert("business_activity_evidence", {
      organization_id: org,
      store_id: store.id,
      source_url: home.url,
      evidence: {
        ...homepage.activity,
        catalog,
        note: "Public availability indicators only. Sales, revenue, inventory and recent activity are not confirmed.",
      },
    });
    for (const e of homepage.shopify)
      await insert("store_technology_evidence", {
        organization_id: org,
        store_id: store.id,
        vendor: "Shopify",
        source_url: home.url,
        evidence: e,
      });
    if (homepage.contact_url) {
      const existing = await checked(
        db()
          .from("contacts")
          .select("id")
          .eq("organization_id", org)
          .eq("store_id", store.id)
          .eq("route", homepage.contact_url),
      );
      if (!existing.length)
        await insert("contacts", {
          organization_id: org,
          store_id: store.id,
          route: homepage.contact_url,
          source_url: home.url,
        });
    }
    await savePublicEmails(org, store.id, homepage.emails, ensureOwnership);
    await emit(
      "verify",
      reason ? "note" : "completed",
      reason ?? "Shopify, activity and country checks passed",
      {
        url: home.url,
        facts: {
          shopify: verified,
          country: country ?? "Unverified",
          emails: homepage.emails.length,
        },
      },
    );
    // A requested audit is for someone who asked for one: report on any site.
    const requested = job.payload.requested === true;
    if (reason && requested)
      await emit(
        "verify",
        "note",
        "Requested audit: continuing without the prospecting checks",
      );
    if (reason && !requested) {
      for (const stage of ["measure", "inspect", "report"] as const)
        await emit(
          stage,
          "skipped",
          "Not needed: the storefront did not pass initial screening",
        );
      await checked(
        db()
          .from("audit_runs")
          .update({
            status: "screened_out",
            completed_at: now(),
            summary: {
              reason,
            },
          })
          .eq("id", audit.id),
      );
      await outcome(
        `Screened out ${store.domain}: ${reason}. No lead or report created.`,
      );
      return;
    }
    await progress(15);
    const samples: PsiSample[] = [];
    let resumedSamples = 0;
    const run = async (strategy: "mobile" | "desktop", sample: number) => {
      let reused = false;
      await emit(
        "measure",
        "started",
        `Measuring ${strategy} performance · sample ${sample} of 3`,
        { url: home.url, facts: { strategy, sample } },
      );
      const s = await checkpointedPageSpeed(
        job,
        home.url,
        strategy,
        sample,
        async () => {
          await emit(
            "measure",
            "note",
            `Waiting for Google PageSpeed · ${strategy} sample ${sample} of 3`,
            {
              url: home.url,
              facts: { strategy, sample, total: 3 },
              task: {
                key: `${strategy}:${sample}`,
                name: `${strategy === "mobile" ? "Mobile" : "Desktop"} · sample ${sample} of 3`,
                state: "waiting",
              },
            },
          );
          return pageSpeed(home.url, strategy, sample, charge);
        },
        ensureOwnership,
        async () => {
          reused = true;
          resumedSamples++;
          payload = { ...payload, resumed_samples: resumedSamples };
          await checked(
            db()
              .from("automation_jobs")
              .update({ payload })
              .eq("organization_id", org)
              .eq("id", job.id)
              .eq("worker_id", job.worker_id)
              .eq("status", "running"),
          );
        },
      );
      const previous = samples.find((x) => x.strategy === strategy);
      if (previous && lighthouseIdentity(s) !== lighthouseIdentity(previous))
        throw new Error(
          "Performance samples have different final URLs or Lighthouse environments; median not published.",
        );
      samples.push(s);
      await insert("audit_metrics", {
        organization_id: org,
        audit_id: audit.id,
        ...s,
      });
      await emit(
        "measure",
        "note",
        reused
          ? `Reused saved ${strategy} measurement`
          : `${strategy === "mobile" ? "Mobile" : "Desktop"} measurement received`,
        {
          url: s.url,
          task: {
            key: `${strategy}:${sample}`,
            name: `${strategy === "mobile" ? "Mobile" : "Desktop"} · sample ${sample} of 3`,
            state: "completed",
          },
          facts: {
            strategy,
            sample,
            performance: s.scores.performance ?? null,
            seo: s.scores.seo ?? null,
            reused,
            tested_at: s.tested_at,
          },
        },
      );
      return s;
    };
    const mobile = await run("mobile", 1);
    await run("desktop", 1);
    await progress(30);
    let screenshot: Buffer | null = null;
    if (config.modules.browser) {
      await ensureOwnership();
      await emit(
        "inspect",
        "started",
        "Capturing read-only mobile browser diagnostics",
        { url: home.url },
      );
      const b = await inspectBrowser(home.url, crawl);
      await emit("inspect", "note", "Mobile browser diagnostics received", {
        url: home.url,
        task: {
          key: "browser",
          name: "Mobile browser diagnostics",
          state: "completed",
        },
      });
      screenshot = b.screenshot;
      const path = `${org}/${audit.id}/mobile.png`;
      await checked(
        db().storage.from("audit-artifacts").upload(path, b.screenshot, {
          contentType: "image/png",
          upsert: true,
        }),
      );
      await insert("audit_screenshots", {
        organization_id: org,
        audit_id: audit.id,
        page_url: home.url,
        storage_path: path,
        viewport: b.viewport,
      });
      if (b.layout.horizontalOverflow)
        homepage.findings.push({
          id: randomUUID(),
          category: "Modernization",
          url: home.url,
          title: "Mobile viewport overflows horizontally",
          evidence:
            "At a 390px viewport, document scrollWidth exceeded window width by more than 2px.",
          severity: "medium",
          confidence: "high",
          recommendation:
            "Locate the overflowing element and correct responsive sizing.",
          kind: "verified",
        });
      await insert("audit_pages", {
        organization_id: org,
        audit_id: audit.id,
        url: home.url,
        kind: "browser-diagnostics",
        metadata: { ...b, screenshot: undefined },
      });
    }
    await insert("audit_pages", {
      organization_id: org,
      audit_id: audit.id,
      url: homepage.url,
      kind: homepage.kind,
      status_code: home.status,
      metadata: homepage,
    });
    const screening = qualifies(
      {
        performance: mobile.scores.performance,
        seo: mobile.scores.seo,
        explicitNeed:
          config.include_frontend_findings !== false &&
          hasFrontendOpportunity({ findings: homepage.findings }),
        verifiedCro: homepage.findings.some(
          (f) => f.category === "CRO" && f.kind === "verified",
        ),
      },
      config,
    );
    if (!screening && !requested) {
      await emit(
        "measure",
        "completed",
        "Initial mobile and desktop measurements saved",
        { facts: { measurements: samples.length } },
      );
      await emit(
        "inspect",
        "skipped",
        "A full page review was not required by the screening thresholds",
      );
      await emit(
        "report",
        "skipped",
        "No report needed: initial scores did not meet the saved thresholds",
      );
      await checked(
        db()
          .from("audit_runs")
          .update({
            status: "screened_out",
            completed_at: now(),
            summary: {
              reason:
                "Initial technical scores do not meet screening thresholds",
              scores: mobile.scores,
            },
          })
          .eq("id", audit.id),
      );
      await outcome(
        `Screened out ${store.domain}: technical scores do not meet the saved thresholds. No lead or report created.`,
      );
      return;
    }
    for (const strategy of ["mobile", "desktop"] as const)
      for (const sample of [2, 3]) await run(strategy, sample);
    await emit("measure", "completed", "Six performance measurements saved", {
      facts: { measurements: samples.length },
    });
    await progress(50);
    await emit(
      "inspect",
      "started",
      "Reviewing representative pages and public contact routes",
      { url: home.url },
    );
    const pages = [homepage];
    const representative = await scanRepresentativePages(crawl, homepage, {
      checkpoint: ensureOwnership,
      onAttempt: async (url, kind) => {
        await emit("inspect", "started", `Reading the ${kind} page`, {
          url,
          task: {
            key: `page:${url}`,
            name: `Review ${kind} page`,
            state: "waiting",
          },
        });
      },
      onComplete: async (page) => {
        await emit("inspect", "note", `Reviewed the ${page.kind} page`, {
          url: page.url,
          facts: {
            status_code: page.http_status,
            findings: page.findings.length,
            emails: page.emails.length,
          },
          task: {
            key: `page:${page.requested_url}`,
            name: `Review ${page.kind} page`,
            state: "completed",
          },
        });
      },
      onSkipped: async (page) => {
        await emit(
          "inspect",
          "note",
          `Skipped unavailable ${page.kind} page: ${page.reason}`,
          {
            url: page.url,
            task: {
              key: `page:${page.url}`,
              name: `Review ${page.kind} page`,
              state: "skipped",
            },
          },
        );
      },
    });
    const pageLimitations = representative.skipped;
    pages.push(...representative.pages);
    // Product pages are where shoppers buy: one phone test of one, beside the
    // home page's three. Optional: a failure here never stops the audit.
    let productSpeed: ProductSpeed | null = null;
    const productPage = representative.pages.find(
      (p) => p.kind === "product" && p.http_status === 200,
    );
    if (productPage && !representative.rateLimited) {
      try {
        await emit(
          "measure",
          "started",
          "Measuring a product page on a phone",
          {
            url: productPage.url,
            task: {
              key: "product:mobile",
              name: "Product page · phone",
              state: "waiting",
            },
          },
        );
        const s = await checkpointedPageSpeed(
          job,
          productPage.url,
          "mobile",
          1,
          () => pageSpeed(productPage.url, "mobile", 1, charge),
          ensureOwnership,
          async () => {},
        );
        productSpeed = productSpeedOf(s);
        await emit("measure", "note", "Product page measured", {
          url: s.url,
          facts: { performance: productSpeed.performance },
          task: {
            key: "product:mobile",
            name: "Product page · phone",
            state: "completed",
          },
        });
      } catch (e) {
        await emit(
          "measure",
          "note",
          `Product page test skipped: ${e instanceof Error ? e.message : "unavailable"}`,
          {
            url: productPage.url,
            task: {
              key: "product:mobile",
              name: "Product page · phone",
              state: "skipped",
            },
          },
        );
      }
    }
    for (const page of representative.pages)
      await savePublicEmails(org, store.id, page.emails, ensureOwnership);
    // A site that is already rate limiting us is not crawled further for contacts.
    if (
      !representative.rateLimited &&
      !pages.some((page) => page.emails.length)
    ) {
      const contactScan = await scanContactPages(crawl, home, {
        onActivity: async (url, state, message, facts) => {
          await emit(
            "inspect",
            state === "skipped" ? "skipped" : "note",
            message,
            {
              url,
              facts,
              task: {
                key: `contact:${url}`,
                name: "Find public contact",
                state,
              },
            },
          );
        },
        knownContactUrl: store.contact_url,
        scannedPages: pages,
        excludedUrls: representative.skipped.map((page) => page.url),
        checkpoint: ensureOwnership,
      });
      pageLimitations.push(
        ...contactScan.errors.map((error) => ({
          url: error.url,
          kind: "contact",
          reason: error.message,
        })),
      );
      for (const page of contactScan.pages) {
        pages.push(page);
        await savePublicEmails(org, store.id, page.emails, ensureOwnership);
      }
    }
    await checked(
      db()
        .from("discovered_stores")
        .update(classifyIndustry(pages))
        .eq("organization_id", org)
        .eq("id", store.id)
        .eq("industry_manual", false),
    );
    const findings = pages.flatMap((p) => p.findings);
    for (const page of pages) {
      await ensureOwnership();
      if (page !== homepage)
        await insert("audit_pages", {
          organization_id: org,
          audit_id: audit.id,
          url: page.url,
          kind: page.kind,
          status_code: page.http_status,
          metadata: page,
        });
      for (const tech of page.technologies)
        await insert("store_technology_evidence", {
          organization_id: org,
          store_id: store.id,
          vendor: tech.vendor,
          source_url: page.url,
          evidence: tech.evidence,
        });
    }
    const titles = new Map<string, string>();
    for (const p of pages) {
      if (p.title && titles.has(p.title))
        findings.push({
          id: randomUUID(),
          category: "SEO",
          url: p.url,
          title: "Duplicate page title",
          evidence: `Title "${p.title}" also observed at ${titles.get(p.title)}`,
          severity: "medium",
          confidence: "high",
          recommendation: "Use descriptive titles specific to each page.",
          kind: "verified",
        });
      titles.set(p.title, p.url);
    }
    // Selected Lighthouse diagnostics retain measured savings only when provided by Lighthouse.
    for (const s of samples.filter((s) => s.sample === 1))
      for (const key of [
        "render-blocking-resources",
        "unused-javascript",
        "unused-css-rules",
        "uses-optimized-images",
        "uses-responsive-images",
        "image-delivery-insight",
        "color-contrast",
        "button-name",
        "link-name",
      ]) {
        const d = s.diagnostics[key] as
          | {
              score?: number;
              title?: string;
              description?: string;
              details?: unknown;
            }
          | undefined;
        if (d && typeof d.score === "number" && d.score < 0.9)
          findings.push({
            id: randomUUID(),
            category: key.includes("image")
              ? "Images"
              : key.includes("name") || key === "color-contrast"
                ? "Accessibility"
                : "Frontend",
            url: s.url,
            title: d.title || key,
            evidence: `Lighthouse ${s.strategy} at ${s.tested_at}: ${JSON.stringify(d.details ?? { score: d.score }).slice(0, 6000)}`,
            severity: "medium",
            confidence: "high",
            recommendation:
              d.description?.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") ||
              "Review the measured Lighthouse diagnostic.",
            kind: "verified",
          });
      }
    let history = "Historical comparison not enabled.";
    if (config.modules.history) {
      await charge("wayback");
      const date = new Date();
      date.setUTCMonth(date.getUTCMonth() - config.history_months);
      const timestamp = date.toISOString().slice(0, 10).replaceAll("-", "");
      const u = `https://archive.org/wayback/available?url=${encodeURIComponent(home.url)}&timestamp=${timestamp}`;
      const response = await providerJson(u);
      const snapshot = response.archived_snapshots?.closest;
      history = snapshot?.available
        ? `An archive snapshot is available at ${snapshot.url} (${snapshot.timestamp}). No visual comparison was performed.`
        : "No historical snapshot was returned. Historical design changes are unknown.";
      await insert("historical_snapshots", {
        organization_id: org,
        audit_id: audit.id,
        source_url: u,
        snapshot_url: snapshot?.url ?? null,
        captured_at: snapshot?.timestamp
          ? `${snapshot.timestamp.slice(0, 4)}-${snapshot.timestamp.slice(4, 6)}-${snapshot.timestamp.slice(6, 8)}T00:00:00Z`
          : null,
        comparison_months: config.history_months,
        evidence: { ...response, visual_comparison: "not_performed" },
      });
    }
    for (const f of findings) await persistFinding(f);
    await emit(
      "inspect",
      "completed",
      "Page observations and public contacts saved",
      {
        facts: {
          pages: pages.length,
          findings: findings.filter((f) => f.kind === "verified").length,
          emails: new Set(pages.flatMap((p) => p.emails.map((e) => e.email)))
            .size,
        },
      },
    );
    await progress(75);
    await emit(
      "report",
      "started",
      config.modules.ai
        ? "Preparing evidence-based AI recommendations"
        : "Preparing the evidence-based audit report",
    );
    const recommendations = config.modules.ai
      ? await recommend(findings, charge)
      : [];
    await emit(
      "report",
      "note",
      config.modules.ai
        ? "Evidence-based recommendations received"
        : "Verified findings collected for the report",
      {
        facts: {
          findings: findings.length,
          recommendations: recommendations.length,
        },
        task: {
          key: "prepare",
          name: "Collect findings and recommendations",
          state: "completed",
        },
      },
    );
    for (const r of recommendations)
      await insert("ai_recommendations", {
        organization_id: org,
        audit_id: audit.id,
        recommendation: r,
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      });
    const scores = (strategy: "mobile" | "desktop", key: string) => {
      const values = samples
        .filter((s) => s.strategy === strategy)
        .map((s) => s.scores[key])
        .filter((v): v is number => typeof v === "number");
      return values.length === 3 ? median(values) : null;
    };
    // Retained for schema compatibility; opportunity is described by grouped findings.
    const modernization = null;
    const review = await checked(
      db()
        .from("contact_permission_reviews")
        .select("*")
        .eq("organization_id", org)
        .eq("store_id", store.id)
        .order("reviewed_at", { ascending: false })
        .limit(1),
    );
    const permission =
      review[0]?.status === "approved" &&
      new Date(review[0].expires_at) > new Date();
    const previousScore = await checked(
      db()
        .from("lead_scores")
        .select("performance,breakdown")
        .eq("organization_id", org)
        .eq("store_id", store.id)
        .neq("audit_id", audit.id)
        .order("created_at", { ascending: false })
        .limit(1),
    );
    const technologies = [
      ...new Set(pages.flatMap((p) => p.technologies.map((t) => t.vendor))),
    ];
    const performance = scores("mobile", "performance");
    const timing = detectTiming(
      { performance, catalog, technologies },
      previousScore[0]
        ? {
            performance: previousScore[0].performance,
            catalog: previousScore[0].breakdown?.catalog,
            technologies: previousScore[0].breakdown?.technologies,
          }
        : null,
    );
    const emails = pages.flatMap((page) => page.emails);
    const mail = {
      ...previousScore[0]?.breakdown?.mail,
      ...(await checkMailDomains(emails)),
    };
    // Pages only a team-run brand links to, for the brand-size check.
    const brand = {
      links: homepage.links
        .filter((l) =>
          /\/(pages\/)?(careers|jobs|join-us|work-with-us|stockists|wholesale|retailers|where-to-buy|trade|press|media|newsroom|investors|investor-relations)\b/i.test(
            new URL(l).pathname,
          ),
        )
        .slice(0, 20),
      locales: homepage.locales ?? 0,
    };
    const priority = leadScore({
      findings,
      performance,
      activity,
      emails,
      mail,
      domain: store.domain,
      title: homepage.title || store.name,
      brand_evidence: brand,
      contact_url: homepage.contact_url,
      catalog,
      fit,
      timing,
      countryVerified: !!country_evidence,
      shopifyVerified: verified,
      permissionApproved: permission,
      suppressed: false,
    });
    const score = {
      technical_seo: scores("mobile", "seo"),
      performance,
      desktop: scores("desktop", "performance"),
      modernization,
      cro: null,
      activity,
      priority: priority.priority,
      breakdown: {
        ...priority,
        catalog,
        fit,
        timing,
        technologies,
        mail,
        brand,
      },
    };
    await insert("lead_scores", {
      organization_id: org,
      audit_id: audit.id,
      store_id: store.id,
      ...score,
    });
    const organization = await checked(
      db().from("organizations").select("name").eq("id", org).single(),
    );
    await emit(
      "report",
      "started",
      "Organizing audit sections and rendering the PDF",
      { task: { key: "render", name: "Render audit PDF", state: "running" } },
    );
    const reportSettings = await checked(
      db()
        .from("app_settings")
        .select("config")
        .eq("organization_id", org)
        .maybeSingle(),
    );
    const pdf = await createReport({
      sender: readSender(reportSettings?.config?.sender),
      name: store.display_name || store.name,
      domain: store.domain,
      date: now(),
      audit_id: audit.id,
      country,
      country_evidence,
      contacts: [
        ...new Map(
          pages
            .flatMap((page) => page.emails)
            .map((email) => [email.email, email]),
        ).values(),
      ],
      pages: pages.map((page) => ({
        url: page.url,
        kind: page.kind,
        status_code: page.http_status,
      })),
      page_limitations: pageLimitations,
      product_speed: productSpeed,
      findings,
      samples,
      recommendations,
      activity,
      priority: priority.priority,
      modernization,
      technologies,
      history,
      agency: reportAgency(organization.name),
      screenshot,
      screenshot_at: screenshot ? now() : null,
    });
    await emit("report", "note", "Audit PDF rendered", {
      task: { key: "render", name: "Render audit PDF", state: "completed" },
    });
    await ensureOwnership();
    const path = `${org}/${audit.id}/report-${reportVersion}.pdf`;
    await emit("report", "started", "Publishing the PDF to private storage", {
      facts: { findings: findings.length },
      task: {
        key: "publish",
        name: "Publish private report",
        state: "waiting",
      },
    });
    await checked(
      db()
        .storage.from("audit-artifacts")
        .upload(path, pdf, { contentType: "application/pdf", upsert: true }),
    );
    await emit(
      "report",
      "completed",
      "PDF saved to private storage; finalizing audit",
      {
        task: {
          key: "publish",
          name: "Publish private report",
          state: "completed",
        },
      },
    );
    await emit(
      "report",
      "started",
      "Creating the report link and completing the audit",
      {
        task: {
          key: "finalize",
          name: "Finalize audit and report link",
          state: "running",
        },
      },
    );
    await checked(
      db().rpc("finalize_audit", {
        org,
        audit: audit.id,
        store: store.id,
        job: job.id,
        worker: job.worker_id,
        report_path: path,
        audit_summary: {
          ...score,
          history,
          scope: "Public representative pages only",
          page_limitations: pageLimitations,
          product_speed: productSpeed,
        },
      }),
    );
  } catch (error) {
    await checked(
      db()
        .from("audit_runs")
        .update({
          status: "failed",
          completed_at: now(),
          error: error instanceof Error ? error.message : "Audit failed",
        })
        .eq("id", audit.id),
    );
    throw error;
  }
}
