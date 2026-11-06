import { describe, it, expect, vi, beforeEach } from "vitest";
import { biggestCities } from "../shared/local-business";

const f = vi.hoisted(() => ({
  cities: [] as string[],
  saved: [] as string[],
}));
vi.mock("../server/lib/db", () => ({
  now: () => new Date().toISOString(),
  checked: async (p: any) => p,
  db: () => ({
    from: () => {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => [],
        upsert: (row: { place_id: string }) => {
          f.saved.push(row.place_id);
          return null;
        },
      };
      return q;
    },
  }),
}));
vi.mock("../server/modules/geoapify", () => ({
  findCity: async (city: string, _c: unknown, charge: () => Promise<void>) => {
    await charge();
    f.cities.push(city);
    return { filter: `place:${city}`, label: city, country: "US" };
  },
  searchPlaces: async (filter: string) => {
    const { readGeoapifyPlace } = await import("../shared/local-business");
    return [
      readGeoapifyPlace({
        properties: {
          place_id: `${filter}:1`,
          name: "Volt Electric",
          categories: ["service", "service.electrician"],
          contact: { phone: "555" },
        },
      })!,
    ];
  },
  placeDetails: async () => null,
}));
vi.mock("../server/modules/web-check", () => ({
  websiteSearchProvider: () => null,
  searchWeb: async () => [],
}));
import { localDiscovery } from "../server/modules/local-discovery";

const config = {
  name: "Electricians in US",
  provider: "geoapify" as const,
  search_id: "s",
  trades: ["electrician"],
  cities: [],
  countries: ["US" as const],
  per_city: 5,
  daily_api_budget: 100,
};
const run = async (resume = {}, charge = async () => {}) => {
  const outcomes: { result: string; details: Record<string, any> }[] = [];
  await localDiscovery(
    "org",
    config,
    charge,
    async (result, details) => {
      outcomes.push({ result, details });
    },
    async () => {},
    async () => {},
    resume,
  ).catch((e) => outcomes.push({ result: "threw", details: { e } }));
  return outcomes;
};

describe("A local search stopped by the daily budget", () => {
  beforeEach(() => {
    f.cities = [];
    f.saved = [];
  });
  it("records the city it stopped on and the counts so far", async () => {
    let n = 0;
    const out = await run({}, async () => {
      if (++n > 2) throw new Error("Daily API request budget exhausted");
    });
    expect(out.at(-1)!.result).toBe("threw");
    const last = out.at(-2)!;
    expect(last.details.next_area).toBe(2);
    expect(last.details.funnel.saved).toBe(2);
    expect(last.result).toBe("Searched 2 of 5 cities; 2 with no website so far");
  });
  it("picks up at that city with its counts, and searches no city twice", async () => {
    const us = biggestCities.US;
    const out = await run({
      next_area: 2,
      funnel: { saved: 2, listed: 2, in_trade: 2 },
    });
    expect(f.cities).toEqual(us.slice(2));
    expect(out.at(-1)!.details.funnel).toMatchObject({ saved: 5, listed: 5 });
    expect(out.at(-1)!.result).toBe(
      "Saved 5 listings with no website (no web search set up for the check)",
    );
  });
  it("starts from the first city when nothing was recorded", async () => {
    await run({ funnel: { saved: 99 } });
    expect(f.cities).toEqual(biggestCities.US);
    expect(f.saved).toHaveLength(5);
  });
});
