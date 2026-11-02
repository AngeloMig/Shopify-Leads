import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  user = "33333333-3333-4333-8333-333333333333",
  store = "44444444-4444-4444-8444-444444444444",
  worker = "55555555-5555-4555-8555-555555555555";
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  for (const filename of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await pg.exec(
      (await readFile(`supabase/migrations/${filename}`, "utf8")).replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  }
  await pg.exec(
    `grant usage on schema public,auth to authenticated,service_role;insert into auth.users values('${user}');insert into organizations(id,name) values('${a}','A'),('${b}','B');insert into organization_members values('${a}','${user}','owner');insert into discovered_stores(id,organization_id,domain,name,source_url,source_provider) values('${store}','${a}','merchant.example','Merchant','https://provider.example','test');`,
  );
});
afterAll(async () => {
  await pg.close();
});
describe("Migration, tenant RLS, and durable queue (real embedded PostgreSQL)", () => {
  it("enables RLS on every public table", async () => {
    const r = await pg.query<{ relname: string }>(
      "select relname from pg_class join pg_namespace on pg_namespace.oid=pg_class.relnamespace where nspname='public' and relkind='r' and not relrowsecurity",
    );
    expect(r.rows).toEqual([]);
  });
  it("prevents duplicate canonical domains per organization", async () => {
    await expect(
      pg.exec(
        `insert into discovered_stores(organization_id,domain,name,source_url,source_provider) values('${a}','merchant.example','Duplicate','https://provider.example','test')`,
      ),
    ).rejects.toThrow(/unique/);
  });
  it("prevents cross-organization audit references", async () => {
    await expect(
      pg.exec(
        `insert into audit_runs(organization_id,store_id) values('${b}','${store}')`,
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("isolates member reads and blocks direct writes", async () => {
    await pg.exec(
      `set role authenticated;set request.jwt.claim.sub='${user}';`,
    );
    try {
      const rows = await pg.query<{ name: string }>(
        "select name from organizations",
      );
      expect(rows.rows.map((r) => r.name)).toEqual(["A"]);
      await expect(
        pg.exec(
          `insert into suppression_list(organization_id,domain,reason) values('${a}','merchant.example','bypass')`,
        ),
      ).rejects.toThrow(/row-level security|permission denied/);
      await expect(
        pg.query(`select * from claim_job('${worker}')`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec("reset role;");
    }
  });
  it("atomically schedules a run once and advances its due date", async () => {
    await pg.exec(
      `insert into discovery_queries(organization_id,name,config,enabled,interval_hours) values('${a}','daily','{}',true,24);select enqueue_due_schedules();select enqueue_due_schedules();`,
    );
    const rows = await pg.query<{ n: number }>(
      `select count(*)::integer as n from automation_jobs where type='discovery'`,
    );
    expect(rows.rows[0].n).toBe(1);
  });
  it("claims jobs, accounts for attempts, and enforces daily API budget", async () => {
    const result = await pg.query<{
      id: string;
      attempts: number;
      worker_id: string;
    }>(`select * from claim_job('${worker}')`);
    const j = result.rows[0];
    expect(j.attempts).toBe(1);
    expect(j.worker_id).toBe(worker);
    expect(
      (await pg.query(`select * from claim_job('${worker}')`)).rows,
    ).toHaveLength(0);
    await pg.query(`select reserve_api_unit('${a}','${j.id}','pagespeed',1)`);
    await expect(
      pg.query(`select reserve_api_unit('${a}','${j.id}','pagespeed',1)`),
    ).rejects.toThrow(/budget exhausted/);
    const budget = await pg.query<{ units: number }>(
      `select units from api_usage_daily where organization_id='${a}'`,
    );
    expect(budget.rows[0].units).toBe(1);
  });
  it("prevents concurrent audit jobs and retries expired leases", async () => {
    await pg.exec(
      `insert into automation_jobs(organization_id,type,dedupe_key) values('${a}','audit','audit:${store}');`,
    );
    await expect(
      pg.exec(
        `insert into automation_jobs(organization_id,type,dedupe_key) values('${a}','audit','audit:${store}')`,
      ),
    ).rejects.toThrow(/unique/);
    await pg.exec(
      `update automation_jobs set lease_until=now()-interval '1 second' where status='running';`,
    );
    const result = await pg.query<{ attempts: number; type: string }>(
      `select * from claim_job('${worker}')`,
    );
    expect(result.rows[0]).toMatchObject({ type: "audit", attempts: 1 });
    const recovered = await pg.query<{ attempts: number; type: string }>(
      `select * from claim_job('${worker}')`,
    );
    expect(recovered.rows[0]).toMatchObject({ type: "discovery", attempts: 2 });
  });
});

describe("Atomic audit publication", () => {
  it("rejects a stale worker without publishing, then atomically publishes with the current lease", async () => {
    const audit = "66666666-6666-4666-8666-666666666666",
      job = "77777777-7777-4777-8777-777777777777",
      other = "88888888-8888-4888-8888-888888888888";
    await pg.exec(
      `insert into audit_runs(id,organization_id,store_id) values('${audit}','${a}','${store}');insert into automation_jobs(id,organization_id,type,status,worker_id,lease_until,payload) values('${job}','${a}','audit','running','${worker}',now()+interval '3 minutes','{"store_id":"${store}"}');`,
    );
    await expect(
      pg.query(
        `select finalize_audit('${a}','${audit}','${store}','${job}','${other}','${a}/${audit}/report.pdf','{}')`,
      ),
    ).rejects.toThrow(/lease lost/);
    expect((await pg.query("select id from leads")).rows).toHaveLength(0);
    expect((await pg.query("select id from reports")).rows).toHaveLength(0);
    await pg.query(
      `select finalize_audit('${a}','${audit}','${store}','${job}','${worker}','${a}/${audit}/report.pdf','{}')`,
    );
    expect((await pg.query("select id from leads")).rows).toHaveLength(1);
    expect((await pg.query("select id from reports")).rows).toHaveLength(1);
    const state = await pg.query<{ status: string }>(
      `select status from audit_runs where id='${audit}'`,
    );
    expect(state.rows[0].status).toBe("completed");
  });
  it("checks suppression again when a running audit is finalized", async () => {
    const audit = "99999999-9999-4999-8999-999999999999",
      job = "77777777-7777-4777-8777-777777777778";
    await pg.exec(
      `insert into audit_runs(id,organization_id,store_id) values('${audit}','${a}','${store}');insert into automation_jobs(id,organization_id,type,status,worker_id,lease_until,payload) values('${job}','${a}','audit','running','${worker}',now()+interval '3 minutes','{"store_id":"${store}"}');insert into suppression_list(organization_id,domain,reason) values('${a}','merchant.example','Opt out during audit');`,
    );
    await expect(
      pg.query(
        `select finalize_audit('${a}','${audit}','${store}','${job}','${worker}','${a}/${audit}/report.pdf','{}')`,
      ),
    ).rejects.toThrow(/suppressed/);
    expect((await pg.query("select id from reports")).rows).toHaveLength(1);
  });
});

describe("Job cancellation", () => {
  it("is tenant-scoped, idempotent and leaves completed history intact", async () => {
    const job = randomUUID();
    await pg.query(
      `insert into automation_jobs(id,organization_id,type) values($1,$2,'discovery')`,
      [job, a],
    );
    expect(
      (
        await pg.query<{ cancel_job: boolean }>(`select cancel_job($1,$2)`, [
          b,
          job,
        ])
      ).rows[0].cancel_job,
    ).toBe(false);
    expect(
      (
        await pg.query<{ cancel_job: boolean }>(`select cancel_job($1,$2)`, [
          a,
          job,
        ])
      ).rows[0].cancel_job,
    ).toBe(true);
    expect(
      (
        await pg.query<{ cancel_job: boolean }>(`select cancel_job($1,$2)`, [
          a,
          job,
        ])
      ).rows[0].cancel_job,
    ).toBe(false);
    const state = (
      await pg.query<{
        status: string;
        attempts: number;
        completed_at: string;
      }>(
        `select status,attempts,completed_at from automation_jobs where id=$1`,
        [job],
      )
    ).rows[0];
    expect(state.status).toBe("cancelled");
    expect(state.attempts).toBe(0);
    expect(state.completed_at).toBeTruthy();
    const done = randomUUID();
    await pg.query(
      `insert into automation_jobs(id,organization_id,type,status) values($1,$2,'discovery','completed')`,
      [done, a],
    );
    expect(
      (
        await pg.query<{ cancel_job: boolean }>(`select cancel_job($1,$2)`, [
          a,
          done,
        ])
      ).rows[0].cancel_job,
    ).toBe(false);
  });
  it("revokes running ownership, blocks new API reservations and child audits, and survives worker writes", async () => {
    const job = randomUUID();
    await pg.query(
      `insert into automation_jobs(id,organization_id,type,status,worker_id,lease_until) values($1,$2,'discovery','running',$3,now()+interval '3 minutes')`,
      [job, a, worker],
    );
    await pg.query(`select cancel_job($1,$2)`, [a, job]);
    await expect(
      pg.query(`select reserve_api_unit($1,$2,'brave',100)`, [a, job]),
    ).rejects.toThrow(/not running/);
    await expect(
      pg.query(`select enqueue_discovered_audit($1,$2,$3,$4,'{}')`, [
        a,
        job,
        worker,
        store,
      ]),
    ).rejects.toThrow(/cancelled/);
    for (const status of ["completed", "queued", "failed"]) {
      const writes = await pg.query(
        `update automation_jobs set status=$1 where id=$2 and worker_id=$3 and status='running' returning id`,
        [status, job, worker],
      );
      expect(writes.rows).toHaveLength(0);
    }
    await pg.query(`select * from claim_job($1)`, [worker]);
    const state = (
      await pg.query<{
        status: string;
        worker_id: string | null;
        lease_until: string | null;
      }>(
        `select status,worker_id,lease_until from automation_jobs where id=$1`,
        [job],
      )
    ).rows[0];
    expect(state).toEqual({
      status: "cancelled",
      worker_id: null,
      lease_until: null,
    });
  });
  it("stops only this workspace's discovery, disables schedules and preserves existing audits", async () => {
    const org = randomUUID(),
      other = randomUUID(),
      query = randomUUID(),
      otherQuery = randomUUID(),
      discovery = randomUUID(),
      audit = randomUUID(),
      foreignJob = randomUUID();
    await pg.query(
      `insert into organizations(id,name) values($1,'Stop test'),($2,'Other')`,
      [org, other],
    );
    await pg.query(
      `insert into discovery_queries(id,organization_id,name,config,enabled,interval_hours) values($1,$2,'Daily','{"enabled":true}',true,24),($3,$4,'Other','{"enabled":true}',true,24)`,
      [query, org, otherQuery, other],
    );
    await pg.query(
      `insert into automation_jobs(id,organization_id,type) values($1,$2,'discovery'),($3,$2,'audit'),($4,$5,'discovery')`,
      [discovery, org, audit, foreignJob, other],
    );
    expect(
      (
        await pg.query<{ stop_discovery: number }>(
          `select stop_discovery($1)`,
          [org],
        )
      ).rows[0].stop_discovery,
    ).toBe(1);
    expect(
      (
        await pg.query<{ enabled: boolean; config: { enabled: boolean } }>(
          `select enabled,config from discovery_queries where id=$1`,
          [query],
        )
      ).rows[0],
    ).toEqual({ enabled: false, config: { enabled: false } });
    await pg.query(`select enqueue_due_schedules()`);
    expect(
      (
        await pg.query<{ id: string }>(
          `select id from automation_jobs where organization_id=$1 and type='discovery'`,
          [org],
        )
      ).rows.map((r) => r.id),
    ).toEqual([discovery]);
    const states = (
      await pg.query<{ id: string; status: string }>(
        `select id,status from automation_jobs where id in ($1,$2,$3) order by id`,
        [discovery, audit, foreignJob],
      )
    ).rows;
    expect(states.find((j) => j.id === discovery)?.status).toBe("cancelled");
    expect(states.find((j) => j.id === audit)?.status).toBe("queued");
    expect(states.find((j) => j.id === foreignJob)?.status).toBe("queued");
    expect(
      (
        await pg.query<{ stop_discovery: number }>(
          `select stop_discovery($1)`,
          [org],
        )
      ).rows[0].stop_discovery,
    ).toBe(0);
  });
  it("does not publish an audit whose job was cancelled first", async () => {
    const audit = randomUUID(),
      job = randomUUID();
    const before = (await pg.query(`select id from reports`)).rows.length;
    await pg.query(
      `insert into audit_runs(id,organization_id,store_id) values($1,$2,$3)`,
      [audit, a, store],
    );
    await pg.query(
      `insert into automation_jobs(id,organization_id,type,status,worker_id,lease_until,payload) values($1,$2,'audit','running',$3,now()+interval '3 minutes',$4)`,
      [job, a, worker, JSON.stringify({ store_id: store })],
    );
    await pg.query(`select cancel_job($1,$2)`, [a, job]);
    await expect(
      pg.query(`select finalize_audit($1,$2,$3,$4,$5,$6,'{}')`, [
        a,
        audit,
        store,
        job,
        worker,
        `${a}/${audit}/report.pdf`,
      ]),
    ).rejects.toThrow(/lease lost/);
    expect((await pg.query(`select id from reports`)).rows).toHaveLength(
      before,
    );
  });
  it("keeps cancellation RPCs inaccessible to browser database roles", async () => {
    await pg.exec(`set role authenticated;`);
    try {
      await expect(pg.query(`select stop_discovery($1)`, [a])).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        pg.query(`select cancel_job($1,$2)`, [a, randomUUID()]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec(`reset role;`);
    }
  });
});
