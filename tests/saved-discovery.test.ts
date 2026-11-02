import { beforeEach, describe, it, expect, vi } from "vitest";
import { defaultSettings, type Job } from "../shared/types";
const f = vi.hoisted(() => ({
  pool: [] as any[],
  events: [] as any[],
  children: [] as any[],
  discover: vi.fn(),
  screen: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../server/lib/db", () => ({
  now: () => new Date().toISOString(),
  checked: async (p: any) => {
    const r = await p;
    if (r.error) throw new Error(r.error.message);
    return r.data;
  },
  db: () => ({
    rpc: f.rpc,
    from: (table: string) => {
      let value: any;
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        contains: () => q,
        single: () => q,
        upsert: (row: any) => {
          value = { id: row.domain };
          return q;
        },
        then: (resolve: any) =>
          resolve({
            error: null,
            data:
              value ??
              {
                discovery_searches: f.events,
                automation_jobs: f.children,
                discovery_search_outcomes: [],
                suppression_list: [],
              }[table] ??
              [],
          }),
      };
      return q;
    },
  }),
}));
vi.mock("../server/lib/discovery-history", () => ({
  discoveryHistory: vi.fn(async () => null),
}));
vi.mock("../server/modules/providers", () => ({ discover: f.discover }));
vi.mock("../server/modules/storefront", () => ({
  inspectStorefront: f.screen,
}));
vi.mock("../shared/lead-intelligence", () => ({
  classifyIndustry: () => ({
    industry: "Beauty & skincare",
    industry_confidence: "high",
  }),
}));
import { savedDiscovery } from "../server/modules/saved-discovery";
const config = {
  ...defaultSettings,
  provider: "tavily" as const,
  countries: ["AU"] as ["AU"],
  batch_size: 3,
  searches_per_run: 1,
};
const job = {
  id: "job",
  organization_id: "org",
  worker_id: "worker",
  payload: { query_id: "campaign" },
  api_usage: {},
} as unknown as Job & { organization_id: string; worker_id: string };
function candidate(i: number, search = "old-search") {
  return {
    id: `candidate-${i}`,
    search_id: search,
    candidate: {
      domain: `store${i}.example`,
      name: `Store ${i}`,
      country: null,
      country_evidence: null,
      industry: "Unknown",
      source_url: `https://store${i}.example`,
      source_provider: "tavily",
      search_country: "AU",
      search_industry: "Beauty & skincare",
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  f.pool = [];
  f.events = [];
  f.children = [];
  f.screen.mockImplementation(async (domain: string) => ({
    verified: true,
    activity: 85,
    country: "AU",
    country_evidence: "Public business address",
    reason: null,
    home: { url: `https://${domain}` },
    homepage: { title: domain },
  }));
  f.rpc.mockImplementation(async (name: string, p: any) => {
    if (name === "claim_discovery_candidate")
      return { data: f.pool.length ? [f.pool.shift()] : [], error: null };
    if (name === "save_discovery_batch") {
      f.pool.push(
        ...p.items.map((c: any, i: number) => ({
          ...candidate(i, "new-search"),
          candidate: c,
        })),
      );
      return { data: "new-search", error: null };
    }
    if (name === "discovery_exclusions") return { data: [], error: null };
    return { data: null, error: null };
  });
});
describe("Saved discovery orchestration", () => {
  it("fills the store target from saved candidates without calling a search provider", async () => {
    f.pool = Array.from({ length: 8 }, (_, i) => candidate(i));
    const outcomes = vi.fn(
      async (_message: string, _details: Record<string, unknown>) => {},
    );
    await savedDiscovery(
      job,
      config,
      null,
      vi.fn(),
      async () => {},
      outcomes,
      async () => {},
    );
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.screen).toHaveBeenCalledTimes(3);
    expect(f.pool).toHaveLength(5);
    expect(outcomes.mock.calls.at(-1)?.[1]).toMatchObject({
      funnel: { queued: 3, saved_used: 3, candidates: 3 },
    });
    expect(
      f.rpc.mock.calls
        .filter(([name]) => name === "enqueue_discovered_audit")
        .map(([, p]) => p.config._search_id),
    ).toEqual(["old-search", "old-search", "old-search"]);
  });
  it("sets aside stores outside the ideal client before queueing any paid audit", async () => {
    f.pool = [candidate(0), candidate(1)];
    f.screen.mockImplementation(async (domain: string) => ({
      verified: true,
      activity: 85,
      country: "AU",
      country_evidence: "Public business address",
      reason: null,
      fitReason:
        domain === "store0.example"
          ? "Outside ideal client: 2 products, below the 10 minimum"
          : null,
      home: { url: `https://${domain}` },
      homepage: { title: domain },
    }));
    const outcomes = vi.fn(
      async (_message: string, _details: Record<string, unknown>) => {},
    );
    await savedDiscovery(
      job,
      { ...config, batch_size: 1 },
      null,
      vi.fn(),
      async () => {},
      outcomes,
      async () => {},
    );
    const settled = f.rpc.mock.calls.filter(
      ([name]) => name === "settle_discovery_candidate",
    );
    expect(settled[0][1]).toMatchObject({
      item_id: "candidate-0",
      next_status: "rejected",
      code_value: "outside_fit",
    });
    const queued = f.rpc.mock.calls.filter(
      ([name]) => name === "enqueue_discovered_audit",
    );
    expect(queued).toHaveLength(1);
    expect(outcomes.mock.calls.at(-1)?.[1]).toMatchObject({
      funnel: { queued: 1, outside_fit: 1 },
    });
  });
  it("stores all twenty results before checking three and leaves the remainder for future runs", async () => {
    const candidates = Array.from(
      { length: 20 },
      (_, i) => candidate(i).candidate,
    );
    f.discover.mockResolvedValue({
      candidates,
      nextCursor: "next",
      summary: {
        query: "skincare Australia",
        keyword: "skincare",
        country: "AU",
        industry: "Beauty & skincare",
        format: "online-shop",
        returned: 20,
        candidates: 20,
        duplicates: 0,
      },
    });
    const outcomes = vi.fn(
      async (_message: string, _details: Record<string, unknown>) => {},
    );
    await savedDiscovery(
      job,
      config,
      null,
      vi.fn(),
      async () => {},
      outcomes,
      async () => {},
    );
    expect(f.discover).toHaveBeenCalledTimes(1);
    expect(f.screen).toHaveBeenCalledTimes(3);
    expect(f.pool).toHaveLength(17);
    expect(outcomes.mock.calls.at(-1)?.[1]).toMatchObject({
      funnel: { queued: 3, saved_used: 0 },
    });
    expect(
      f.rpc.mock.calls.find(([name]) => name === "save_discovery_batch")?.[1]
        .items,
    ).toHaveLength(20);
  });
  it("uses persisted child jobs to avoid exceeding the batch target after an interrupted run", async () => {
    f.children = [{ id: "one" }, { id: "two" }, { id: "three" }];
    f.pool = [candidate(1)];
    await savedDiscovery(
      job,
      config,
      null,
      vi.fn(),
      async () => {},
      async () => {},
      async () => {},
    );
    expect(f.screen).not.toHaveBeenCalled();
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.pool).toHaveLength(1);
  });
  it("checks ownership before touching a candidate or making another provider request", async () => {
    await expect(
      savedDiscovery(
        job,
        config,
        null,
        vi.fn(),
        async () => {
          throw new Error("Worker lease lost");
        },
        async () => {},
        async () => {},
      ),
    ).rejects.toThrow("lease lost");
    expect(f.discover).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
