import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import {
  nameTokens,
  readListing,
  readWebsiteSearch,
  withoutWebsite,
} from "../shared/local-business";

describe("Which Places results get a website check", () => {
  it("keeps open listings that link no website", () => {
    expect(
      withoutWebsite([
        {
          id: "place-aaaaaaaa",
          displayName: { text: "Ridgeway Builders" },
          businessStatus: "OPERATIONAL",
        },
        {
          id: "place-bbbbbbbb",
          displayName: { text: "Has Site Co" },
          websiteUri: "https://hassite.example",
        },
        {
          id: "place-cccccccc",
          displayName: { text: "Closed Roofing" },
          businessStatus: "CLOSED_PERMANENTLY",
        },
        { id: "place-dddddddd", displayName: { text: "" } },
        { displayName: { text: "No ID" } },
      ]),
    ).toEqual([{ place_id: "place-aaaaaaaa", name: "Ridgeway Builders" }]);
  });
});

describe("Business name words", () => {
  it("separates the business's own words from the trade and company form", () => {
    expect(nameTokens("Harbor & Pine Roofing LLC").distinct).toEqual([
      "harbor",
      "pine",
    ]);
    expect(nameTokens("ABC Construction Inc").distinct).toEqual([]);
    expect(nameTokens("ABC Construction Inc").words).toEqual([
      "abc",
      "construction",
      "inc",
    ]);
  });
});

describe("Reading the website check search", () => {
  it("finds no website when only listings and social pages turn up", () => {
    const v = readWebsiteSearch("Ridgeway Builders", [
      {
        url: "https://www.yelp.com/biz/ridgeway-builders-austin",
        title: "Ridgeway Builders - Yelp",
      },
      {
        url: "https://www.facebook.com/ridgewaybuilders",
        title: "Ridgeway Builders | Austin TX",
      },
      {
        url: "https://www.instagram.com/ridgeway.builds/",
        title: "Ridgeway (@ridgeway.builds)",
      },
      {
        url: "https://www.bbb.org/us/tx/austin/profile/ridgeway",
        title: "Ridgeway Builders | BBB",
      },
    ]);
    expect(v.website_check).toBe("no_site_found");
    expect(v.found_site).toBeNull();
    expect(v.social_links).toEqual([
      { network: "facebook", url: "https://www.facebook.com/ridgewaybuilders" },
      {
        network: "instagram",
        url: "https://www.instagram.com/ridgeway.builds/",
      },
    ]);
  });
  it("finds the business's own site when its domain and title name it", () => {
    const v = readWebsiteSearch("Ridgeway Builders", [
      {
        url: "https://www.facebook.com/ridgewaybuilders",
        title: "Ridgeway Builders",
      },
      {
        url: "https://ridgewaybuildstx.com/",
        title: "Ridgeway Builders | Custom homes in Austin",
      },
    ]);
    expect(v).toMatchObject({
      website_check: "site_found",
      found_site: "ridgewaybuildstx.com",
    });
  });
  it("doesn't take a page that only mentions the name for their site", () => {
    const v = readWebsiteSearch("Ridgeway Builders", [
      {
        url: "https://austinnews.example/best-builders",
        title: "Ridgeway Builders wins local award",
      },
      { url: "https://ridgewaymall.example/", title: "Shops and dining" },
    ]);
    expect(v.website_check).toBe("no_site_found");
  });
  it("needs every word when the name is all trade words", () => {
    expect(
      readWebsiteSearch("ABC Construction", [
        { url: "https://abcconstruction.example/", title: "ABC Construction" },
      ]).website_check,
    ).toBe("site_found");
    expect(
      readWebsiteSearch("ABC Construction", [
        { url: "https://construction.example/abc", title: "ABC Construction" },
      ]).website_check,
    ).toBe("no_site_found");
  });
  it("skips social search pages and unrelated profiles", () => {
    const v = readWebsiteSearch("Copperline Roofing", [
      {
        url: "https://www.facebook.com/public/Copperline-Roofing",
        title: "Copperline Roofing profiles",
      },
      { url: "https://www.instagram.com/someoneelse/", title: "Roof photos" },
      { url: "not a url" },
    ]);
    expect(v.social_links).toEqual([]);
  });
});

describe("Reading a Places listing", () => {
  it("keeps only fields that came back", () => {
    expect(
      readListing(
        {
          displayName: { text: "Ridgeway Builders" },
          formattedAddress: "1 Sample St, Austin, TX",
          nationalPhoneNumber: "(555) 010-0000",
          rating: 4.6,
          userRatingCount: 31,
          regularOpeningHours: {
            weekdayDescriptions: ["Monday: 7 AM–5 PM", 3],
          },
        },
        true,
      ),
    ).toEqual({
      name: "Ridgeway Builders",
      address: "1 Sample St, Austin, TX",
      maps_url: null,
      status: null,
      type: null,
      phone: "(555) 010-0000",
      rating: 4.6,
      reviews: 31,
      hours: ["Monday: 7 AM–5 PM"],
      website: null,
    });
    expect(readListing({ displayName: { text: "" } })).toBeNull();
  });
});

const org = "11111111-1111-4111-8111-111111111111";
let pg: PGlite;
describe("Local business tables (real embedded PostgreSQL)", () => {
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(
      `create role anon; create role authenticated; create role service_role bypassrls; create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
    );
    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pg.exec(
        (await readFile(`supabase/migrations/${f}`, "utf8")).replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    await pg.exec(`insert into organizations(id,name) values('${org}','A')`);
  }, 120000);
  afterAll(async () => {
    await pg?.close();
  });
  it("keeps one row per place and rejects unknown check states", async () => {
    const insert = (check: string) =>
      pg.exec(
        `insert into local_businesses(organization_id,place_id,trade,city,country,website_check) values('${org}','place-aaaaaaaa','Builder','Austin, TX','US','${check}')`,
      );
    await insert("no_site_found");
    await expect(insert("no_site_found")).rejects.toThrow(/unique/);
    await expect(
      pg.exec(
        `insert into local_businesses(organization_id,place_id,trade,city,country,website_check) values('${org}','place-bbbbbbbb','Builder','Austin, TX','US','maybe')`,
      ),
    ).rejects.toThrow(/check/);
  });
  it("caps live listing lookups per day", async () => {
    await pg.exec(
      `insert into app_settings(organization_id,config) values('${org}','{"places_view_daily_budget":2}') on conflict(organization_id) do update set config=excluded.config`,
    );
    const take = async () =>
      (
        await pg.query<{ ok: boolean }>(
          `select public.reserve_places_view('${org}',300) as ok`,
        )
      ).rows[0].ok;
    expect([await take(), await take(), await take()]).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe("Places and website-check requests", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  beforeAll(() => {
    process.env.GOOGLE_PLACES_API_KEY = "test-places-key";
    process.env.TAVILY_API_KEY = "test-tavily-key";
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const body = String(url).includes("searchText")
        ? {
            places: [
              {
                id: "place-aaaaaaaa",
                displayName: { text: "Ridgeway Builders" },
              },
            ],
          }
        : String(url).includes("tavily")
          ? {
              results: [
                {
                  url: "https://www.facebook.com/ridgeway",
                  title: "Ridgeway Builders",
                },
              ],
            }
          : {
              id: "place-aaaaaaaa",
              displayName: { text: "Ridgeway Builders" },
              rating: 4.5,
            };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.TAVILY_API_KEY;
  });
  it("charges before searching and asks only for the fields it needs", async () => {
    const { searchPlaces, placeListing, searchWeb, websiteSearchProvider } =
      await import("../server/modules/google-places");
    let charged = 0;
    const places = await searchPlaces(
      "Builder in Austin, TX",
      "US",
      50,
      async () => {
        charged++;
        expect(calls).toHaveLength(0);
      },
    );
    expect(charged).toBe(1);
    expect(places).toHaveLength(1);
    const search = calls[0];
    expect(search.url).toBe(
      "https://places.googleapis.com/v1/places:searchText",
    );
    const headers = search.init.headers as Record<string, string>;
    expect(headers["X-Goog-FieldMask"]).toBe(
      "places.id,places.displayName,places.websiteUri,places.businessStatus,nextPageToken",
    );
    expect(JSON.parse(String(search.init.body))).toMatchObject({
      textQuery: "Builder in Austin, TX",
      pageSize: 20,
      regionCode: "US",
    });
    expect(await placeListing("place-aaaaaaaa", "detail")).toMatchObject({
      name: "Ridgeway Builders",
      rating: 4.5,
    });
    expect(
      (calls[1].init.headers as Record<string, string>)["X-Goog-FieldMask"],
    ).toContain("nationalPhoneNumber");
    expect(websiteSearchProvider()).toBe("tavily");
    const hits = await searchWeb(
      "tavily",
      '"Ridgeway Builders" Austin, TX',
      "US",
    );
    expect(hits).toHaveLength(1);
    expect(JSON.parse(String(calls[2].init.body))).toMatchObject({
      query: '"Ridgeway Builders" Austin, TX',
      country: "united states",
      max_results: 10,
      include_raw_content: false,
    });
  });
});
