import express from "express";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import type { Server } from "node:http";
const f = vi.hoisted(() => ({ rows: {} as Record<string, any[]> }));
vi.mock("../server/lib/db", () => ({
  now: () => new Date().toISOString(),
  checked: async (p: any) => {
    const r = await p;
    if (r.error) throw new Error(r.error.message);
    return r.data;
  },
  db: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let single = false;
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: () => {
          single = true;
          return q;
        },
        then: (resolve: any) => {
          const rows = (f.rows[table] ?? []).filter((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v),
          );
          resolve({ data: single ? (rows[0] ?? null) : rows, error: null });
        },
      };
      return q;
    },
  }),
}));
import { registerJobActivityRoutes } from "../server/job-activity-routes";
let server: Server, base: string;
const id = "11111111-1111-4111-8111-111111111111",
  store = "22222222-2222-4222-8222-222222222222",
  audit = "33333333-3333-4333-8333-333333333333";
beforeAll(async () => {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.org = "workspace-a";
    next();
  });
  registerJobActivityRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
});
beforeEach(() => {
  f.rows = {
    automation_jobs: [],
    discovered_stores: [],
    audit_runs: [],
    audit_pages: [],
    audit_metrics: [],
    audit_findings: [],
    reports: [],
  };
});
describe("Workspace-scoped run activity API", () => {
  it("does not expose a different workspace’s run", async () => {
    f.rows.automation_jobs = [
      {
        id,
        organization_id: "workspace-b",
        payload: { secret: "foreign evidence" },
      },
    ];
    const response = await fetch(`${base}/api/jobs/${id}/activity`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("foreign evidence");
  });
  it("validates an audit reference against both workspace and store before reading evidence", async () => {
    f.rows.automation_jobs = [
      {
        id,
        organization_id: "workspace-a",
        type: "audit",
        payload: { store_id: store, audit_id: audit },
      },
    ];
    f.rows.discovered_stores = [
      {
        id: store,
        organization_id: "workspace-a",
        name: "Own store",
        domain: "own.example",
      },
    ];
    f.rows.audit_runs = [
      { id: audit, organization_id: "workspace-b", store_id: store },
    ];
    f.rows.audit_metrics = [
      {
        organization_id: "workspace-b",
        audit_id: audit,
        scores: { performance: 99 },
      },
    ];
    const response = await fetch(`${base}/api/jobs/${id}/activity`),
      data = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data.target.domain).toBe("own.example");
    expect(data.measurements).toEqual([]);
    expect(data.report_id).toBeNull();
  });
  it("returns retained measurements and the report for the owned audit only", async () => {
    f.rows.automation_jobs = [
      {
        id,
        organization_id: "workspace-a",
        type: "audit",
        payload: { store_id: store, audit_id: audit },
      },
    ];
    f.rows.discovered_stores = [
      {
        id: store,
        organization_id: "workspace-a",
        name: "Own store",
        domain: "own.example",
      },
    ];
    f.rows.audit_runs = [
      { id: audit, organization_id: "workspace-a", store_id: store },
    ];
    f.rows.audit_metrics = [
      {
        organization_id: "workspace-a",
        audit_id: audit,
        strategy: "mobile",
        sample: 1,
        scores: { performance: 42 },
      },
      {
        organization_id: "workspace-b",
        audit_id: audit,
        scores: { performance: 99 },
      },
    ];
    f.rows.reports = [
      { id: "report", organization_id: "workspace-a", audit_id: audit },
    ];
    const data = await (await fetch(`${base}/api/jobs/${id}/activity`)).json();
    expect(data.measurements).toHaveLength(1);
    expect(data.measurements[0].scores.performance).toBe(42);
    expect(data.report_id).toBe("report");
  });
});
