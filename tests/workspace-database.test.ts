import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const org = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  user = "33333333-3333-4333-8333-333333333333",
  store = "44444444-4444-4444-8444-444444444444",
  audit = "55555555-5555-4555-8555-555555555555",
  worker = "66666666-6666-4666-8666-666666666666";
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort())
    await pg.exec(
      (await readFile(`supabase/migrations/${file}`, "utf8")).replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await pg.exec(
    `grant usage on schema public,auth to authenticated,service_role;insert into auth.users values('${user}');insert into organizations(id,name) values('${org}','A'),('${other}','B');insert into organization_members values('${org}','${user}','owner');insert into discovered_stores(id,organization_id,domain,name,source_url,source_provider) values('${store}','${org}','store.example','Long original title','https://store.example','test');insert into audit_runs(id,organization_id,store_id,status) values('${audit}','${org}','${store}','completed');insert into leads(organization_id,store_id,audit_id) values('${org}','${store}','${audit}');insert into lead_scores(organization_id,audit_id,store_id,performance,priority,breakdown) values('${org}','${audit}','${store}',30,0,'{}');insert into audit_findings(organization_id,audit_id,url,category,title,evidence,severity,confidence,recommendation,kind) values('${org}','${audit}','https://store.example','Frontend','Unused code','Recorded','medium','high','Review','verified');`,
  );
});
afterAll(async () => {
  await pg.close();
});
describe("Lead workspace persistence and boundaries", () => {
  it("queues an imported store once even after its original job completes",async()=>{
    const imported='99999999-9999-4999-8999-999999999999';
    await pg.exec(`insert into discovered_stores(id,organization_id,domain,name,source_url,source_provider) values('${imported}','${org}','import.example','Import','https://import.example','manual-import');`);
    expect((await pg.query<{queued:boolean}>(`select enqueue_first_audit('${org}','${imported}','{}') as queued`)).rows[0].queued).toBe(true);
    expect((await pg.query<{queued:boolean}>(`select enqueue_first_audit('${org}','${imported}','{}') as queued`)).rows[0].queued).toBe(false);
    await pg.exec(`update automation_jobs set status='completed' where organization_id='${org}' and payload->>'store_id'='${imported}'`);
    expect((await pg.query<{queued:boolean}>(`select enqueue_first_audit('${org}','${imported}','{}') as queued`)).rows[0].queued).toBe(false);
    await expect(pg.query(`select enqueue_first_audit('${other}','${imported}','{}')`)).rejects.toThrow(/Store not found/);
  });
  it("ranks a technical opportunity independently from unknown outreach permission", async () => {
    const r = await pg.query<{ opportunity_rank: number; permission: string }>(
      `select opportunity_rank,permission from lead_search_index where organization_id='${org}'`,
    );
    expect(r.rows).toEqual([{ opportunity_rank: 2, permission: "unknown" }]);
  });
  it("preserves the original title while making edited names searchable", async () => {
    await pg.exec(
      `update discovered_stores set display_name='Short Brand' where id='${store}'`,
    );
    const r = await pg.query<{
      name: string;
      business_name: string;
      search_text: string;
    }>(
      `select s.name,i.business_name,i.search_text from lead_search_index i join discovered_stores s on s.id=i.store_id where i.organization_id='${org}'`,
    );
    expect(r.rows[0].name).toBe("Long original title");
    expect(r.rows[0].business_name).toBe("Short Brand");
    expect(r.rows[0].search_text).toContain("Short Brand");
  });
  it("does not expose the privileged search view or allow direct writes to member clients", async () => {
    await pg.exec(
      `set role authenticated;set request.jwt.claim.sub='${user}';`,
    );
    try {
      await expect(pg.query("select * from lead_search_index")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        pg.exec(
          `insert into worker_heartbeats(organization_id,worker_id,state) values('${org}','${worker}','idle')`,
        ),
      ).rejects.toThrow(/permission denied|row-level security/);
    } finally {
      await pg.exec("reset role;");
    }
  });
  it("isolates member reads of worker health and review candidates", async () => {
    await pg.exec(
      `insert into worker_heartbeats(organization_id,worker_id,state) values('${org}','${worker}','idle'),('${other}','${worker}','idle');set role authenticated;set request.jwt.claim.sub='${user}';`,
    );
    try {
      const r = await pg.query<{ organization_id: string }>(
        "select organization_id from worker_heartbeats",
      );
      expect(r.rows.map((x) => x.organization_id)).toEqual([org]);
    } finally {
      await pg.exec("reset role;");
    }
  });
  it("enforces category budgets and the shared total atomically", async () => {
    await pg.exec(
      `insert into app_settings(organization_id,config) values('${org}','{"discovery_daily_budget":1,"audit_daily_budget":2,"daily_api_budget":3}');insert into automation_jobs(id,organization_id,type,status,lease_until) values('77777777-7777-4777-8777-777777777777','${org}','discovery','running',now()+interval '1 hour'),('88888888-8888-4888-8888-888888888888','${org}','audit','running',now()+interval '1 hour');`,
    );
    await pg.query(
      `select reserve_api_unit('${org}','77777777-7777-4777-8777-777777777777','tavily',100)`,
    );
    await expect(
      pg.query(
        `select reserve_api_unit('${org}','77777777-7777-4777-8777-777777777777','tavily',100)`,
      ),
    ).rejects.toThrow(/budget exhausted/);
    for (let n = 0; n < 2; n++)
      await pg.query(
        `select reserve_api_unit('${org}','88888888-8888-4888-8888-888888888888','pagespeed',100)`,
      );
    await expect(
      pg.query(
        `select reserve_api_unit('${org}','88888888-8888-4888-8888-888888888888','pagespeed',100)`,
      ),
    ).rejects.toThrow(/budget exhausted/);
    const r = await pg.query(
      "select units,discovery_units,audit_units from api_usage_daily",
    );
    expect(r.rows).toEqual([{ units: 3, discovery_units: 1, audit_units: 2 }]);
  });
  it("rejects cross-tenant search-event attribution", async () => {
    await expect(
      pg.exec(
        `insert into discovery_searches(organization_id,job_id,sequence,query,keyword,industry,country) values('${other}','77777777-7777-4777-8777-777777777777',1,'q','niche','fashion','US')`,
      ),
    ).rejects.toThrow(/foreign key/);
  });
});
