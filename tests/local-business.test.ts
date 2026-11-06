import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import {
  inTrade,
  localTrade,
  nameTokens,
  readGeoapifyPlace,
  readWebsiteSearch,
} from "../shared/local-business";

const feature = (properties: Record<string, unknown>) => ({ properties });
describe("Reading a Geoapify place", () => {
  it("reads contact details from normalized fields, then raw OSM tags", () => {
    const place = readGeoapifyPlace(
      feature({
        place_id: "51abcdef0123",
        name: "Ridgeway Builders",
        formatted: "1 Sample St, Austin, TX 78701, United States",
        lat: 30.27,
        lon: -97.74,
        categories: ["office", "office.company"],
        datasource: {
          raw: {
            phone: "+1 555 010 0000",
            "contact:facebook": "ridgewaybuilders",
            instagram: "https://www.instagram.com/ridgeway.builds/",
            office: "construction_company",
            opening_hours: "Mo-Fr 07:00-17:00",
            osm_type: "n",
            osm_id: 12345,
          },
        },
      }),
    );
    expect(place).toMatchObject({
      place_id: "51abcdef0123",
      name: "Ridgeway Builders",
      phone: "+1 555 010 0000",
      website: null,
      opening_hours: "Mo-Fr 07:00-17:00",
      osm_url: "https://www.openstreetmap.org/node/12345",
      has_contact_fields: true,
      social_links: [
        {
          network: "facebook",
          url: "https://www.facebook.com/ridgewaybuilders",
        },
        {
          network: "instagram",
          url: "https://www.instagram.com/ridgeway.builds/",
        },
      ],
    });
    expect(place!.trade_tags).toContain("construction_company");
  });
  it("finds a website wherever OSM put it", () => {
    expect(
      readGeoapifyPlace(
        feature({ place_id: "51aaaaaaaa", name: "A", website: "a.example" }),
      )!.website,
    ).toBe("https://a.example/");
    expect(
      readGeoapifyPlace(
        feature({
          place_id: "51aaaaaaaa",
          name: "A",
          datasource: { raw: { "contact:website": "https://a.example" } },
        }),
      )!.website,
    ).toBe("https://a.example/");
  });
  it("asks for details when the result carried no contact fields", () => {
    expect(
      readGeoapifyPlace(feature({ place_id: "51aaaaaaaa", name: "A" }))!
        .has_contact_fields,
    ).toBe(false);
    expect(readGeoapifyPlace(feature({ place_id: "51aaaaaaaa" }))).toBeNull();
  });
});

describe("Matching a trade", () => {
  const place = (name: string, raw: Record<string, unknown> = {}) =>
    readGeoapifyPlace(
      feature({ place_id: "51aaaaaaaa", name, datasource: { raw } }),
    )!;
  it("matches broad categories by name or OSM tag", () => {
    const construction = localTrade("construction")!;
    expect(inTrade(construction, place("Ridgeway Builders"))).toBe(true);
    expect(
      inTrade(
        construction,
        place("Hill Partners", { office: "construction_company" }),
      ),
    ).toBe(true);
    expect(inTrade(construction, place("Hill Accounting"))).toBe(false);
    expect(inTrade(localTrade("roofing")!, place("Copperline Roofing"))).toBe(
      true,
    );
  });
  it("doesn't take office buildings, head offices or suppliers for trades", () => {
    const at = (name: string, categories: string[]) =>
      readGeoapifyPlace(feature({ place_id: "51aaaaaaaa", name, categories }))!;
    const construction = localTrade("construction")!;
    expect(
      inTrade(
        construction,
        at("Intel Corporation", [
          "building",
          "building.office",
          "office.company",
        ]),
      ),
    ).toBe(false);
    expect(
      inTrade(
        construction,
        at("Perry Brooks Building", ["building.office", "office.company"]),
      ),
    ).toBe(false);
    expect(
      inTrade(
        construction,
        at("Chuy's Restaurant Home Office", ["office.company"]),
      ),
    ).toBe(false);
    expect(
      inTrade(
        construction,
        at("Trimbuilt Construction Inc", ["office.company"]),
      ),
    ).toBe(true);
    expect(
      inTrade(
        localTrade("electrician")!,
        at("Crawford Electric Supply", ["service", "service.electrician"]),
      ),
    ).toBe(false);
  });
  it("keeps everything in a trade's own category, and only that", () => {
    const inCategory = (name: string, categories: string[]) =>
      readGeoapifyPlace(feature({ place_id: "51aaaaaaaa", name, categories }))!;
    expect(
      inTrade(
        localTrade("electrician")!,
        inCategory("Spark & Sons", ["service", "service.electrician"]),
      ),
    ).toBe(true);
    expect(
      inTrade(
        localTrade("electrician")!,
        inCategory("Volt Electric LLC", ["office", "office.company"]),
      ),
    ).toBe(true);
    expect(
      inTrade(
        localTrade("spa")!,
        inCategory("Cut Above", [
          "service",
          "service.beauty",
          "service.beauty.hairdresser",
        ]),
      ),
    ).toBe(false);
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

describe("Sorting one area's businesses into the chosen trades", () => {
  const at = (id: string, name: string, categories: string[]) =>
    readGeoapifyPlace(feature({ place_id: id, name, categories }))!;
  it("saves each business once, under a trade with its own category first", async () => {
    const { assignTrades } = await import("../server/modules/local-discovery");
    const places = [
      at("51aaaaaaa1", "Volt Electric", ["office", "office.company"]),
      at("51aaaaaaa2", "Spark & Sons", ["service", "service.electrician"]),
      at("51aaaaaaa3", "Ridgeway Builders", ["office", "office.company"]),
      at("51aaaaaaa4", "Paws Vet Clinic", ["pet", "pet.veterinary"]),
      at("51aaaaaaa5", "Hill Accounting", ["office", "office.company"]),
    ];
    const picked = assignTrades(
      places,
      ["construction", "electrician", "vet"].map((t) => localTrade(t)!),
      5,
    ).map((m) => `${m.trade.id}:${m.place.name}`);
    expect(picked.sort()).toEqual(
      [
        "construction:Ridgeway Builders",
        "electrician:Spark & Sons",
        "electrician:Volt Electric",
        "vet:Paws Vet Clinic",
      ].sort(),
    );
    expect(
      assignTrades(places, [localTrade("electrician")!], 1).map(
        (m) => m.place.name,
      ),
    ).toHaveLength(1);
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
  it("stores several trades and countries per search, cities optional", async () => {
    await pg.exec(
      `insert into local_searches(organization_id,trades,countries,cities) values('${org}','{construction,vet}','{US,GB,CA,AU}','{}')`,
    );
    await expect(
      pg.exec(
        `insert into local_searches(organization_id,trades,countries,cities) values('${org}','{vet}','{FR}','{}')`,
      ),
    ).rejects.toThrow(/check/);
  });
  it("keeps one row per place and rejects unknown check states", async () => {
    const insert = (check: string) =>
      pg.exec(
        `insert into local_businesses(organization_id,place_id,trade,city,country,name,website_check) values('${org}','place-aaaaaaaa','Builder','Austin, TX','US','Ridgeway','${check}')`,
      );
    await insert("no_site_found");
    await expect(insert("no_site_found")).rejects.toThrow(/unique/);
    await expect(
      pg.exec(
        `insert into local_businesses(organization_id,place_id,trade,city,country,name,website_check) values('${org}','place-bbbbbbbb','Builder','Austin, TX','US','Ridgeway','maybe')`,
      ),
    ).rejects.toThrow(/check/);
  });
});

describe("Geoapify and website-check requests", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  beforeAll(() => {
    process.env.GEOAPIFY_API_KEY = "test-geoapify-key";
    process.env.TAVILY_API_KEY = "test-tavily-key";
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      const body = u.includes("/geocode/")
        ? {
            results: [
              {
                place_id: "city-austin-0001",
                formatted: "Austin, TX, United States",
                country_code: "us",
              },
            ],
          }
        : u.includes("/v2/places")
          ? {
              features: [
                feature({ place_id: "51aaaaaaaa", name: "Ridgeway Builders" }),
              ],
            }
          : u.includes("place-details")
            ? {
                features: [
                  feature({
                    place_id: "51aaaaaaaa",
                    name: "Ridgeway Builders",
                    contact: { phone: "555" },
                  }),
                ],
              }
            : {
                results: [
                  {
                    url: "https://www.facebook.com/ridgeway",
                    title: "Ridgeway Builders",
                  },
                ],
              };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    delete process.env.GEOAPIFY_API_KEY;
    delete process.env.TAVILY_API_KEY;
  });
  it("charges before every request and bounds places to the city", async () => {
    const { findCity, searchPlaces, placeDetails } = await import(
      "../server/modules/geoapify"
    );
    const { searchWeb, websiteSearchProvider } = await import(
      "../server/modules/web-check"
    );
    let charged = 0;
    const charge = async () => {
      expect(calls).toHaveLength(charged);
      charged++;
    };
    const city = await findCity("Austin, TX", ["US", "CA"], charge);
    expect(city).toEqual({
      filter: "place:city-austin-0001",
      label: "Austin, TX, United States",
      country: "US",
    });
    const geocode = new URL(calls[0].url);
    expect(geocode.pathname).toBe("/v1/geocode/search");
    expect(Object.fromEntries(geocode.searchParams)).toMatchObject({
      text: "Austin, TX",
      type: "city",
      filter: "countrycode:us,ca",
      apiKey: "test-geoapify-key",
    });
    const places = await searchPlaces(
      city!.filter,
      ["office.company", "commercial.trade"],
      900,
      charge,
    );
    expect(places.map((p) => p.name)).toEqual(["Ridgeway Builders"]);
    const list = new URL(calls[1].url);
    expect(Object.fromEntries(list.searchParams)).toMatchObject({
      categories: "office.company,commercial.trade",
      filter: "place:city-austin-0001",
      limit: "500",
    });
    expect((await placeDetails("51aaaaaaaa", charge))!.phone).toBe("555");
    expect(new URL(calls[2].url).searchParams.get("id")).toBe("51aaaaaaaa");
    expect(charged).toBe(3);
    expect(websiteSearchProvider()).toBe("tavily");
    expect(
      await searchWeb("tavily", '"Ridgeway Builders" Austin, TX', "US"),
    ).toHaveLength(1);
    expect(JSON.parse(String(calls[3].init.body))).toMatchObject({
      query: '"Ridgeway Builders" Austin, TX',
      country: "united states",
      max_results: 10,
      include_raw_content: false,
    });
  });
});
