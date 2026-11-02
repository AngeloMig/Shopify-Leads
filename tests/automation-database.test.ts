import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await pg.exec(
      (await readFile(`supabase/migrations/${file}`, "utf8")).replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await pg.exec(
    "grant usage on schema public to anon,authenticated,service_role;",
  );
});
afterAll(async () => pg.close());

async function campaignFixture(org: string, worker: string) {
  const campaign = randomUUID();
  await pg.query(
    "insert into discovery_queries(id,organization_id,name,config,interval_hours) values($1,$2,'Saved discovery',$3,24)",
    [
      campaign,
      org,
      JSON.stringify({
        countries: ["AU"],
        industries: ["Beauty & skincare"],
        excluded_domains: [],
      }),
    ],
  );
  const job = await enqueue(org, "discovery", { query_id: campaign });
  await pg.query(
    "update automation_jobs set status='running',worker_id=$1,lease_until=now()+interval '3 minutes' where id=$2",
    [worker, job],
  );
  return { campaign, job };
}
async function saveBatch(
  org: string,
  worker: string,
  campaign: string,
  job: string,
  count = 20,
) {
  const summary = {
    query: "natural skincare online shop Australia",
    keyword: "natural skincare",
    country: "AU",
    industry: "Beauty & skincare",
    format: "online-shop",
    returned: count,
    duplicates: 0,
    credits: 1,
    credits_measured: true,
  };
  const items = Array.from({ length: count }, (_, i) => ({
    domain: `store${i}.example`,
    name: `Store ${i}`,
    search_country: "AU",
    search_industry: "Beauty & skincare",
    source_url: `https://store${i}.example/`,
    source_provider: "tavily",
    priority: i,
  }));
  return (
    await pg.query<{ id: string }>(
      "select save_discovery_batch($1,$2,$3,$4,1,$5,$6,$7) as id",
      [
        org,
        job,
        worker,
        campaign,
        JSON.stringify(summary),
        '{"v":3,"step":1}',
        JSON.stringify(items),
      ],
    )
  ).rows[0].id;
}
describe("Saved discovery candidates and query attribution", () => {
  it("recovers a cancelled parent’s candidate without waiting for its old lease", async () => {
    const { org, worker } = await workspace(),
      { campaign, job } = await campaignFixture(org, worker);
    await saveBatch(org, worker, campaign, job, 1);
    const first = (
      await pg.query<{ id: string }>(
        "select * from claim_discovery_candidate($1,$2,$3,$4,'[\"AU\"]')",
        [org, job, worker, campaign],
      )
    ).rows[0];
    await pg.query("select cancel_job($1,$2)", [org, job]);
    expect(
      (
        await pg.query<{ s: any }>(
          "select discovery_pool_summary($1,$2) as s",
          [org, campaign],
        )
      ).rows[0].s,
    ).toMatchObject({ pending: 1, checking: 0 });
    const replacement = await enqueue(org, "discovery", { query_id: campaign });
    await pg.query(
      "update automation_jobs set status='running',worker_id=$1,lease_until=now()+interval '3 minutes' where id=$2",
      [worker, replacement],
    );
    expect(
      (
        await pg.query<{ id: string }>(
          "select * from claim_discovery_candidate($1,$2,$3,$4,'[\"AU\"]')",
          [org, replacement, worker, campaign],
        )
      ).rows[0].id,
    ).toBe(first.id);
    await expect(
      pg.query(
        "select settle_discovery_candidate($1,$2,$3,$4,'queued','Late result','','*',now())",
        [org, job, worker, first.id],
      ),
    ).rejects.toThrow(/lease lost/);
  });
  it("saves all returned candidates atomically and retains seventeen after three checks", async () => {
    const { org, worker } = await workspace(),
      { campaign, job } = await campaignFixture(org, worker);
    await saveBatch(org, worker, campaign, job);
    const picked: string[] = [];
    for (let n = 0; n < 3; n++) {
      const row = (
        await pg.query<{ id: string; domain: string }>(
          "select * from claim_discovery_candidate($1,$2,$3,$4,'[\"AU\"]')",
          [org, job, worker, campaign],
        )
      ).rows[0];
      picked.push(row.domain);
      await pg.query(
        "select settle_discovery_candidate($1,$2,$3,$4,'queued','Verified','','*',now())",
        [org, job, worker, row.id],
      );
    }
    expect(picked).toEqual([
      "store19.example",
      "store18.example",
      "store17.example",
    ]);
    await saveBatch(org, worker, campaign, job);
    expect(
      (
        await pg.query<{ summary: any }>(
          "select discovery_pool_summary($1,$2) as summary",
          [org, campaign],
        )
      ).rows[0].summary,
    ).toMatchObject({ pending: 17, queued: 3 });
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int as n from discovery_searches where organization_id=$1",
          [org],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pg.query<{ source_cursor: string }>(
          "select source_cursor from discovery_queries where id=$1",
          [campaign],
        )
      ).rows[0].source_cursor,
    ).toBe('{"v":3,"step":1}');
  });
  it("fences persistence and claims by workspace, current worker and cancellation", async () => {
    const { org, worker } = await workspace(),
      { campaign, job } = await campaignFixture(org, worker),
      other = await workspace();
    await expect(saveBatch(org, randomUUID(), campaign, job)).rejects.toThrow(
      /lease lost/,
    );
    await expect(saveBatch(other.org, worker, campaign, job)).rejects.toThrow(
      /lease lost/,
    );
    await pg.query("select cancel_job($1,$2)", [org, job]);
    await expect(saveBatch(org, worker, campaign, job)).rejects.toThrow(
      /lease lost/,
    );
    await expect(
      pg.query(
        "select * from claim_discovery_candidate($1,$2,$3,$4,'[\"AU\"]')",
        [org, job, worker, campaign],
      ),
    ).rejects.toThrow(/lease lost/);
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int as n from discovery_candidates where organization_id=$1",
          [org],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("remembers rejection cooldowns, respects new exclusions and reclaims interrupted checks", async () => {
    const { org, worker } = await workspace(),
      { campaign, job } = await campaignFixture(org, worker);
    await saveBatch(org, worker, campaign, job, 2);
    const params = [org, job, worker, campaign];
    const first = (
      await pg.query<{ id: string; domain: string }>(
        "select * from claim_discovery_candidate($1,$2,$3,$4,'[\"AU\"]')",
        params,
      )
    ).rows[0];
    const recovered = (
      await pg.query<{ id: string }>(
        "select * from claim_discovery_candidate($1,$2,$3,$4,'[\"AU\"]')",
        params,
      )
    ).rows[0];
    expect(recovered.id).toBe(first.id);
    await pg.query(
      "select settle_discovery_candidate($1,$2,$3,$4,'rejected','Not Shopify','not_storefront','*',now()+interval '30 days')",
      [org, job, worker, first.id],
    );
    await pg.query(
      "update discovery_queries set config=jsonb_set(config,'{excluded_domains}','[\"store0.example\"]') where id=$1",
      [campaign],
    );
    expect(
      (
        await pg.query(
          "select * from claim_discovery_candidate($1,$2,$3,$4,'[\"AU\"]')",
          params,
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await pg.query<{ domain: string }>(
          "select * from discovery_exclusions($1,'[\"AU\"]')",
          [org],
        )
      ).rows,
    ).toContainEqual({ domain: first.domain });
    await pg.query(
      "update discovery_rejections set retry_at=now()-interval '1 second' where organization_id=$1",
      [org],
    );
    await pg.query(
      "update discovery_candidates set next_check_at=now()-interval '1 second' where id=$1",
      [first.id],
    );
    expect(
      (
        await pg.query<{ id: string }>(
          "select * from claim_discovery_candidate($1,$2,$3,$4,'[\"AU\"]')",
          params,
        )
      ).rows[0].id,
    ).toBe(first.id);
  });
  it("does not expose candidate evidence or performance views through public roles", async () => {
    await pg.exec("set role authenticated");
    await expect(
      pg.query("select * from discovery_candidates"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      pg.query("select * from discovery_search_outcomes"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      pg.query("select discovery_pool_summary(gen_random_uuid(),null)"),
    ).rejects.toThrow(/permission denied/);
    await pg.exec("reset role");
  });
  it("attributes published audits and suitable contacts to the actual source search", async () => {
    const { org, worker } = await workspace(),
      { campaign, job } = await campaignFixture(org, worker);
    const search = await saveBatch(org, worker, campaign, job, 1),
      store = randomUUID(),
      oldAudit = randomUUID(),
      newAudit = randomUUID();
    await pg.query(
      "insert into discovered_stores(id,organization_id,domain,name,source_url,source_provider) values($1,$2,'merchant.example','Merchant','https://merchant.example','tavily')",
      [store, org],
    );
    await pg.query(
      "insert into audit_runs(id,organization_id,store_id,status) values($1,$2,$3,'completed')",
      [oldAudit, org, store],
    );
    await pg.query(
      "insert into reports(organization_id,audit_id,store_id,storage_path) values($1,$2,$3,'old-report.pdf')",
      [org, oldAudit, store],
    );
    const auditJob = await enqueue(org, "audit", {
      store_id: store,
      search_id: search,
    });
    await pg.query(
      "update automation_jobs set status='completed' where id=$1",
      [auditJob],
    );
    expect(
      (
        await pg.query<{ completed_audits: number }>(
          "select completed_audits from discovery_search_outcomes where id=$1",
          [search],
        )
      ).rows[0].completed_audits,
    ).toBe(0);
    await pg.query("update automation_jobs set status='running' where id=$1", [
      auditJob,
    ]);
    await pg.query(
      "insert into audit_runs(id,organization_id,store_id) values($1,$2,$3)",
      [newAudit, org, store],
    );
    await pg.query("update audit_runs set status='completed' where id=$1", [
      newAudit,
    ]);
    await pg.query(
      "insert into reports(organization_id,audit_id,store_id,storage_path) values($1,$2,$3,'new-report.pdf')",
      [org, newAudit, store],
    );
    await pg.query(
      "update automation_jobs set status='completed' where id=$1",
      [auditJob],
    );
    await pg.query(
      "insert into contacts(organization_id,store_id,route,source_url) values($1,$2,'mailto:hr@merchant.example','https://merchant.example/contact')",
      [org, store],
    );
    expect(
      (
        await pg.query<{ completed_audits: number; suitable_contacts: number }>(
          "select completed_audits,suitable_contacts from discovery_search_outcomes where id=$1",
          [search],
        )
      ).rows[0],
    ).toEqual({ completed_audits: 1, suitable_contacts: 0 });
    await pg.query(
      "insert into contacts(organization_id,store_id,route,source_url) values($1,$2,'mailto:info@merchant.example','https://merchant.example/contact')",
      [org, store],
    );
    expect(
      (
        await pg.query<{ suitable_contacts: number }>(
          "select suitable_contacts from discovery_search_outcomes where id=$1",
          [search],
        )
      ).rows[0].suitable_contacts,
    ).toBe(1);
    const outcomes = async () =>
      (
        await pg.query<{ won_leads: number; not_fit_leads: number }>(
          "select won_leads,not_fit_leads from discovery_search_outcomes where id=$1",
          [search],
        )
      ).rows[0];
    expect(await outcomes()).toEqual({ won_leads: 0, not_fit_leads: 0 });
    await pg.query(
      "insert into leads(organization_id,store_id,audit_id,outcome,outcome_at) values($1,$2,$3,'won',now())",
      [org, store, newAudit],
    );
    expect(await outcomes()).toEqual({ won_leads: 1, not_fit_leads: 0 });
    await pg.query(
      "update leads set outcome='lost',outcome_reason='No budget' where organization_id=$1 and store_id=$2",
      [org, store],
    );
    expect(await outcomes()).toEqual({ won_leads: 0, not_fit_leads: 0 });
    await pg.query(
      "update leads set outcome_reason='Not a fit' where organization_id=$1 and store_id=$2",
      [org, store],
    );
    expect(await outcomes()).toEqual({ won_leads: 0, not_fit_leads: 1 });
    await expect(
      pg.query("update leads set outcome='maybe' where organization_id=$1", [
        org,
      ]),
    ).rejects.toThrow(/check constraint/);
    expect(
      (
        await pg.query<{ outcome: string }>(
          "select outcome from lead_search_index where organization_id=$1 and store_id=$2",
          [org, store],
        )
      ).rows[0].outcome,
    ).toBe("lost");
    await pg.query(
      "insert into lead_scores(organization_id,audit_id,store_id,priority,breakdown) values($1,$2,$3,0,'{\"researchScore\":63}')",
      [org, newAudit, store],
    );
    const score = async () =>
      (
        await pg.query<{ research_score: number | null }>(
          "select research_score from lead_search_index where organization_id=$1 and store_id=$2",
          [org, store],
        )
      ).rows[0].research_score;
    expect(await score()).toBe(63);
    await pg.query(
      "insert into suppression_list(organization_id,domain,reason) values($1,'merchant.example','Opted out')",
      [org],
    );
    expect(await score()).toBeNull();
  });
});
async function workspace() {
  const org = randomUUID(),
    worker = randomUUID();
  await pg.query("insert into organizations(id,name) values($1,$2)", [
    org,
    "Test",
  ]);
  return { org, worker };
}
async function enqueue(org: string, type = "audit", payload = {}) {
  const id = randomUUID();
  await pg.query(
    "insert into automation_jobs(id,organization_id,type,payload) values($1,$2,$3,$4)",
    [id, org, type, JSON.stringify(payload)],
  );
  return id;
}
describe("Durable automation controls in PostgreSQL", () => {
  it("records a provider pause atomically and ignores failure side effects after cancellation", async () => {
    const { org, worker } = await workspace(),
      id = await enqueue(org);
    await pg.query(
      "update automation_jobs set status='running',attempts=1,worker_id=$1,lease_until=now()+interval '3 minutes' where id=$2",
      [worker, id],
    );
    expect(
      (
        await pg.query<{ settle_job_failure: boolean }>(
          "select settle_job_failure($1,$2,$3,'blocked','Forbidden','credentials','pagespeed',now(),false)",
          [org, id, worker],
        )
      ).rows[0].settle_job_failure,
    ).toBe(true);
    expect(
      (
        await pg.query<{ status: string }>(
          "select status from automation_jobs where id=$1",
          [id],
        )
      ).rows[0].status,
    ).toBe("blocked");
    expect(
      (
        await pg.query(
          "select provider from provider_blocks where organization_id=$1",
          [org],
        )
      ).rows,
    ).toEqual([{ provider: "pagespeed" }]);
    const cancelled = await enqueue(org);
    await pg.query(
      "update automation_jobs set status='running',worker_id=$1,lease_until=now()+interval '3 minutes' where id=$2",
      [worker, cancelled],
    );
    await pg.query("select cancel_job($1,$2)", [org, cancelled]);
    expect(
      (
        await pg.query<{ settle_job_failure: boolean }>(
          "select settle_job_failure($1,$2,$3,'blocked','Forbidden','credentials','tavily',now(),false)",
          [org, cancelled, worker],
        )
      ).rows[0].settle_job_failure,
    ).toBe(false);
    expect(
      (
        await pg.query(
          "select provider from provider_blocks where organization_id=$1 and provider='tavily'",
          [org],
        )
      ).rows,
    ).toEqual([]);
  });
  it("releases budget waits after a cap increase but respects a zero category cap", async () => {
    const { org, worker } = await workspace(),
      id = await enqueue(org);
    await pg.query("insert into app_settings values($1,$2)", [
      org,
      '{"daily_api_budget":200,"audit_daily_budget":0}',
    ]);
    await pg.query(
      "update automation_jobs set wait_reason='budget',available_at=now()+interval '1 day' where id=$1",
      [id],
    );
    await pg.query("select * from claim_job($1)", [worker]);
    expect(
      (
        await pg.query<{ waiting: boolean }>(
          "select available_at>now() as waiting from automation_jobs where id=$1",
          [id],
        )
      ).rows[0].waiting,
    ).toBe(true);
    await pg.query(
      "update app_settings set config=jsonb_set(config,'{audit_daily_budget}','200') where organization_id=$1",
      [org],
    );
    await pg.query("select * from claim_job($1)", [worker]);
    expect(
      (
        await pg.query<{ waiting: boolean }>(
          "select available_at>now() as waiting from automation_jobs where id=$1",
          [id],
        )
      ).rows[0].waiting,
    ).toBe(false);
  });
  it("fences checkpoint writes by tenant, owner and cancellation", async () => {
    const { org, worker } = await workspace(),
      other = (await workspace()).org,
      id = await enqueue(org);
    await pg.query(
      `update automation_jobs set status='running',worker_id=$1,lease_until=now()+interval '3 minutes' where id=$2`,
      [worker, id],
    );
    await pg.query("select save_job_checkpoint($1,$2,$3,$4,$5,$6)", [
      org,
      id,
      worker,
      "mobile:1",
      "signature",
      '{"value":40}',
    ]);
    await expect(
      pg.query("select save_job_checkpoint($1,$2,$3,$4,$5,$6)", [
        other,
        id,
        worker,
        "mobile:1",
        "signature",
        "{}",
      ]),
    ).rejects.toThrow(/lease lost/);
    await expect(
      pg.query("select save_job_checkpoint($1,$2,$3,$4,$5,$6)", [
        org,
        id,
        randomUUID(),
        "mobile:1",
        "signature",
        "{}",
      ]),
    ).rejects.toThrow(/lease lost/);
    await pg.query("select cancel_job($1,$2)", [org, id]);
    await expect(
      pg.query("select save_job_checkpoint($1,$2,$3,$4,$5,$6)", [
        org,
        id,
        worker,
        "mobile:1",
        "signature",
        "{}",
      ]),
    ).rejects.toThrow(/lease lost/);
    expect(
      (
        await pg.query("select result from job_checkpoints where job_id=$1", [
          id,
        ])
      ).rows,
    ).toEqual([{ result: { value: 40 } }]);
  });
  it("prioritizes audits and holds discovery at the backlog threshold", async () => {
    const { org, worker } = await workspace();
    await pg.query("insert into app_settings values($1,$2)", [
      org,
      '{"max_audit_backlog":1}',
    ]);
    const discovery = await enqueue(org, "discovery"),
      audit = await enqueue(org);
    expect(
      (
        await pg.query<{ reason: string }>(
          "select reason from automation_queue_reasons($1) where id=$2",
          [org, discovery],
        )
      ).rows[0].reason,
    ).toBe("backlog");
    expect(
      (await pg.query<{ id: string }>("select * from claim_job($1)", [worker]))
        .rows[0].id,
    ).toBe(audit);
    await pg.query(
      "update automation_jobs set status='completed',worker_id=null,lease_until=null where id=$1",
      [audit],
    );
    // Other fixtures may retain ready jobs; use their own workspace queue reason as the gate assertion.
    expect(
      (
        await pg.query<{ reason: string }>(
          "select reason from automation_queue_reasons($1) where id=$2",
          [org, discovery],
        )
      ).rows[0].reason,
    ).toBe("ready");
  });
  it("caps scheduled runs, advances due dates and does not enable disabled campaigns", async () => {
    const { org } = await workspace(),
      query = randomUUID();
    await pg.query(
      "insert into discovery_queries(id,organization_id,name,config,enabled,interval_hours) values($1,$2,$3,$4,true,24)",
      [query, org, "daily", "{}"],
    );
    await pg.exec("select enqueue_due_schedules()");
    await pg.query(
      "update automation_jobs set status='completed' where organization_id=$1",
      [org],
    );
    await pg.query(
      "update discovery_queries set next_run_at=now()-interval '1 minute' where id=$1",
      [query],
    );
    await pg.exec("select enqueue_due_schedules()");
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int n from automation_jobs where organization_id=$1 and payload->>'scheduled'='true'",
          [org],
        )
      ).rows[0].n,
    ).toBe(1);
    await pg.query("select stop_discovery($1)", [org]);
    await pg.exec("select enqueue_due_schedules()");
    expect(
      (
        await pg.query<{ enabled: boolean }>(
          "select enabled from discovery_queries where id=$1",
          [query],
        )
      ).rows[0].enabled,
    ).toBe(false);
  });
  it("keeps a blocked provider from reserving requests and isolates other tenants", async () => {
    const { org, worker } = await workspace(),
      other = (await workspace()).org,
      id = await enqueue(org);
    await pg.query(
      "update automation_jobs set status='running',worker_id=$1,lease_until=now()+interval '3 minutes' where id=$2",
      [worker, id],
    );
    await pg.query(
      "insert into provider_blocks(organization_id,provider,reason,code) values($1,'pagespeed','Invalid credentials','credentials')",
      [org],
    );
    await expect(
      pg.query("select reserve_api_unit($1,$2,'pagespeed',100)", [org, id]),
    ).rejects.toThrow(/Provider paused/);
    expect(
      (
        await pg.query(
          "select * from api_usage_daily where organization_id=$1",
          [org],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await pg.query(
          "select * from provider_blocks where organization_id=$1",
          [other],
        )
      ).rows,
    ).toEqual([]);
  });
  it("does not expose privileged checkpoints or summary functions to public clients", async () => {
    await pg.exec("set role anon");
    try {
      await expect(pg.query("select * from job_checkpoints")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        pg.query("select automation_summary($1)", [randomUUID()]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec("reset role");
    }
  });
  it("does not pretend legacy stores have a known first-seen time", async () => {
    const { org } = await workspace();
    const summary = (
      await pg.query<{ automation_summary: any }>(
        "select automation_summary($1)",
        [org],
      )
    ).rows[0].automation_summary;
    expect(summary.stores_found).toBe(0);
    expect(summary.searches_total).toBe(0);
    expect(summary.duplicate_tracking_searches).toBe(0);
  });
  it("allows blocked jobs to be cancelled without requeueing them", async () => {
    const { org } = await workspace(),
      id = await enqueue(org);
    await pg.query("update automation_jobs set status='blocked' where id=$1", [
      id,
    ]);
    expect(
      (
        await pg.query<{ cancel_job: boolean }>("select cancel_job($1,$2)", [
          org,
          id,
        ])
      ).rows[0].cancel_job,
    ).toBe(true);
    expect(
      (
        await pg.query<{ status: string }>(
          "select status from automation_jobs where id=$1",
          [id],
        )
      ).rows[0].status,
    ).toBe("cancelled");
  });
});
