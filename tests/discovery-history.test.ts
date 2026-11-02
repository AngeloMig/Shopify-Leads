import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type Job } from "../shared/types";
const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, any>[]>,
  reads: [] as { table: string; filters: Record<string, unknown> }[],
  writes: [] as { table: string; patch: Record<string, any> }[],
  rpc: vi.fn(),
  discover: vi.fn(),
  screen: vi.fn(),
}));
vi.mock("../server/lib/db", () => ({
  now: () => new Date().toISOString(),
  insert: vi.fn(),
  checked: async (query: PromiseLike<any>) => {
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    return result.data;
  },
  db: () => ({
    rpc: fixture.rpc,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let single = false;
      let payload: Record<string, unknown> | undefined;
      let patch: Record<string, any> | undefined;
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return query;
        },
        gt() {
          return query;
        },
        limit() {
          return query;
        },
        order() {
          return query;
        },
        single() {
          single = true;
          return query;
        },
        upsert(value: Record<string, any>) {
          const row = {
            id: `${table}-${(fixture.rows[table] ?? []).length + 1}`,
            checked: 0,
            verified: 0,
            queued: 0,
            previously_researched: 0,
            rejected: 0,
            ...value,
          };
          fixture.rows[table] = [...(fixture.rows[table] ?? []), row];
          return query;
        },
        maybeSingle() {
          single = true;
          return query;
        },
        update(value: Record<string, any>) {
          patch = value;
          return query;
        },
        contains(_key: string, value: Record<string, unknown>) {
          payload = value;
          return query;
        },
        then(resolve: (result: any) => void) {
          if (patch) fixture.writes.push({ table, patch });
          fixture.reads.push({ table, filters: { ...filters } });
          const data = (fixture.rows[table] ?? []).filter(
            (row) =>
              Object.entries(filters).every(
                ([key, value]) => row[key] === value,
              ) &&
              (!payload ||
                Object.entries(payload).every(
                  ([key, value]) => row.payload?.[key] === value,
                )),
          );
          resolve({ data: single ? (data[0] ?? null) : data, error: null });
        },
      };
      return query;
    },
  }),
}));
vi.mock("../server/modules/providers", () => ({
  discover: fixture.discover,
  pageSpeed: vi.fn(),
}));
vi.mock("../server/modules/storefront", () => ({
  inspectStorefront: fixture.screen,
}));
import { discoveryHistory } from "../server/lib/discovery-history";
import { executeJob } from "../server/pipeline";

const org = "workspace-a";
const parent: Job & { organization_id: string; worker_id: string } = {
  id: "discovery",
  organization_id: org,
  worker_id: "worker",
  status: "running",
  type: "discovery",
  payload: { config: defaultSettings },
  progress: 0,
  created_at: "2026-10-27T00:00:00Z",
  started_at: "2026-10-27T00:00:00Z",
  completed_at: null,
  error: null,
  attempts: 1,
  max_attempts: 3,
  api_usage: {},
};
beforeEach(() => {
  vi.clearAllMocks();
  fixture.reads = [];
  fixture.writes = [];
  fixture.rows = {
    discovered_stores: [
      { id: "store", domain: "merchant.com", organization_id: org },
    ],
    audit_runs: [],
    automation_jobs: [{ ...parent }],
  };
  fixture.rpc.mockResolvedValue({ data: null, error: null });
  fixture.discover.mockResolvedValue({
    candidates: [{ domain: "merchant.com", name: "Merchant" }],
    nextCursor: null,
  });
  fixture.screen.mockResolvedValue({
    home: { url: "https://merchant.com/" },
    homepage: { title: "Merchant" },
    country: "US",
    country_evidence: "fixture",
    verified: true,
    activity: 85,
    reason: null,
  });
});
describe("Retained discovery history, independent of the last 100 search hits", () => {
  it("retains an active Shopify candidate whose country needs human review", async () => {
    fixture.screen.mockResolvedValueOnce({
      home: { url: "https://merchant.com/" },
      homepage: { title: "Merchant" },
      country: null,
      country_evidence: null,
      verified: true,
      activity: 85,
      reason: "Target country unverified or excluded",
    });
    await executeJob(parent);
    expect(fixture.rows.candidate_reviews?.[0]).toMatchObject({
      organization_id: org,
      domain: "merchant.com",
    });
    expect(fixture.rpc).not.toHaveBeenCalledWith(
      "enqueue_discovered_audit",
      expect.anything(),
    );
  });
  it("passes repeated zero-yield keyword feedback to discovery without extra searches", async () => {
    fixture.rows.discovery_searches = [1, 2].map((i) => ({
      id: String(i),
      organization_id: org,
      query_id: undefined,
      completed: true,
      country: "US",
      industry: "Fashion & apparel",
      keyword: "boutique",
      queued: 0,
    }));
    fixture.discover.mockResolvedValue({ candidates: [], nextCursor: null });
    await executeJob(parent);
    expect(fixture.discover.mock.calls[0][3]).toEqual([
      expect.objectContaining({
        country: "US",
        industry: "Fashion & apparel",
        keyword: "boutique",
      }),
    ]);
    expect(fixture.discover).toHaveBeenCalledOnce();
  });
  it("attributes queued audits to their originating search event", async () => {
    fixture.discover.mockResolvedValue({
      candidates: [{ domain: "merchant.com", name: "Merchant" }],
      nextCursor: null,
      summary: {
        query: "boutique online shop US",
        keyword: "boutique",
        industry: "Fashion & apparel",
        country: "US",
        returned: 1,
      },
    });
    await executeJob(parent);
    expect(fixture.rpc).toHaveBeenCalledWith(
      "enqueue_discovered_audit",
      expect.objectContaining({
        config: expect.objectContaining({ _search_id: "discovery_searches-1" }),
      }),
    );
    expect(fixture.writes).toContainEqual({
      table: "discovery_searches",
      patch: expect.objectContaining({ queued: 1, verified: 1 }),
    });
  });
  it("makes at most three searches and records the discovery funnel", async () => {
    fixture.discover.mockResolvedValue({ candidates: [], nextCursor: "next" });
    await executeJob({
      ...parent,
      payload: {
        config: { ...defaultSettings, provider: "tavily", searches_per_run: 3 },
      },
    });
    expect(fixture.discover).toHaveBeenCalledTimes(3);
    expect(fixture.discover.mock.calls[1][2]).toBe("next");
    expect(fixture.writes.at(-1)?.patch.payload.funnel).toMatchObject({
      search_limit: 3,
      queued: 0,
      returned: 0,
      checked: 0,
    });
  });
  it("stops searching when the requested store target is reached", async () => {
    await executeJob({
      ...parent,
      payload: {
        config: {
          ...defaultSettings,
          provider: "tavily",
          searches_per_run: 3,
          batch_size: 1,
        },
      },
    });
    expect(fixture.discover).toHaveBeenCalledOnce();
    expect(fixture.writes.at(-1)?.patch.payload.funnel).toMatchObject({
      checked: 1,
      shopify: 1,
      active: 1,
      country: 1,
      queued: 1,
    });
  });
  it.each([
    [2, 1],
    [3, 0],
  ])(
    "counts %i previous Tavily reservations across retries",
    async (used, remaining) => {
      fixture.discover.mockResolvedValue({ candidates: [], nextCursor: null });
      const execution = executeJob({
        ...parent,
        api_usage: { tavily: used },
        payload: {
          config: {
            ...defaultSettings,
            provider: "tavily",
            searches_per_run: 3,
          },
        },
      });
      if (used >= 3)
        await expect(execution).rejects.toMatchObject({ code: "search_limit" });
      else await execution;
      expect(fixture.discover).toHaveBeenCalledTimes(remaining);
    },
  );
  it("finds a prior audit even when no completed job remains", async () => {
    fixture.rows.audit_runs.push({
      id: "audit",
      organization_id: org,
      store_id: "store",
      status: "completed",
    });
    expect(await discoveryHistory(org, "merchant.com")).toEqual({
      store_id: "store",
      seen: true,
    });
    expect(
      fixture.reads.every((read) => read.filters.organization_id === org),
    ).toBe(true);
  });
  it("recognizes queued, failed and cancelled audit jobs as prior work", async () => {
    for (const status of ["queued", "failed", "cancelled"]) {
      fixture.rows.automation_jobs = [
        {
          organization_id: org,
          type: "audit",
          status,
          payload: { store_id: "store" },
        },
      ];
      expect((await discoveryHistory(org, "merchant.com"))?.seen).toBe(true);
    }
  });
  it("does not use another workspace's store or audit history", async () => {
    expect(await discoveryHistory("workspace-b", "merchant.com")).toBeNull();
    fixture.rows.audit_runs.push({
      organization_id: "workspace-b",
      store_id: "store",
    });
    expect((await discoveryHistory(org, "merchant.com"))?.seen).toBe(false);
  });
  it("skips old stores before crawling and enqueueing, with a visible outcome", async () => {
    fixture.rows.audit_runs.push({ organization_id: org, store_id: "store" });
    await executeJob(parent);
    expect(fixture.screen).not.toHaveBeenCalled();
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(
      fixture.writes.some(({ patch }) =>
        patch.payload?.result?.includes("1 previously researched skipped"),
      ),
    ).toBe(true);
  });
  it("also skips a new domain that redirects to a previously researched store", async () => {
    fixture.rows.audit_runs.push({ organization_id: org, store_id: "store" });
    fixture.discover.mockResolvedValue({
      candidates: [{ domain: "alias.com" }],
      nextCursor: null,
    });
    await executeJob(parent);
    expect(fixture.screen).toHaveBeenCalledOnce();
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("recovers a store saved before a crash but never queued for its first audit", async () => {
    await executeJob(parent);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith(
      "enqueue_discovered_audit",
      expect.objectContaining({ org, store: "store" }),
    );
  });
});
