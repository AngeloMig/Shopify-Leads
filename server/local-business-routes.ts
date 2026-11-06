import type { Express, Response, Request, NextFunction } from "express";
import { z } from "zod";
import { db, checked, now } from "./lib/db.js";
import { uuid } from "./lib/validation.js";
import { enqueue } from "./pipeline.js";
import { geoapifyConfigured } from "./modules/geoapify.js";
import { websiteSearchProvider } from "./modules/web-check.js";
import type { LocalSearchConfig } from "./modules/local-discovery.js";
import {
  localCountries,
  localStages,
  localTrade,
  localTrades,
  maxSearchTrades,
} from "../shared/local-business.js";
import type { Country } from "../shared/types.js";

const route =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
const columns =
  "id,place_id,trade,city,country,name,address,phone,email,opening_hours,lat,lon,osm_url,website_check,found_site,check_query,social_links,stage,notes,suppressed,found_at";
const status = () => ({
  geoapify_configured: geoapifyConfigured(),
  website_check: websiteSearchProvider(),
});

export function registerLocalBusinessRoutes(
  app: Express,
  admin: (res: Response) => void,
) {
  app.get(
    "/api/local-businesses",
    route(async (req, res) => {
      const input = z
        .object({
          view: z.enum(["no_site", "all"]).default("no_site"),
          q: z.string().trim().max(100).default(""),
          stage: z
            .enum(["any", ...localStages] as [string, ...string[]])
            .default("any"),
          has: z.enum(["any", "phone", "social"]).default("any"),
          page: z.coerce.number().int().min(0).max(1000).default(0),
          size: z.coerce.number().int().min(5).max(50).default(20),
        })
        .parse(req.query);
      // The view, search and stage narrow everything on the page; "has" picks
      // within that, so its counts stay visible while it's on.
      const base = (select: string, head = false) => {
        let query = db()
          .from("local_businesses")
          .select(select, { count: "exact", head })
          .eq("organization_id", res.locals.org)
          .eq("suppressed", false);
        if (input.view === "no_site")
          query = query.in("website_check", ["no_site_found", "not_checked"]);
        if (input.stage !== "any") query = query.eq("stage", input.stage);
        if (input.q) {
          const like = `%${input.q.replace(/[%_,()\\]/g, " ")}%`;
          query = query.or(
            `name.ilike.${like},city.ilike.${like},trade.ilike.${like}`,
          );
        }
        return query;
      };
      type Query = ReturnType<typeof base>;
      const withPhone = (q: Query) => q.not("phone", "is", null);
      const withSocial = (q: Query) => q.not("social_links", "eq", "[]");
      let rows = base(columns);
      if (input.has === "phone") rows = withPhone(rows);
      if (input.has === "social") rows = withSocial(rows);
      const [{ data, count, error }, all, phone, social] = await Promise.all([
        rows
          .order("found_at", { ascending: false })
          .range(
            input.page * input.size,
            input.page * input.size + input.size - 1,
          ),
        base("id", true),
        withPhone(base("id", true)),
        withSocial(base("id", true)),
      ]);
      for (const r of [all, phone, social])
        if (r.error) throw new Error(r.error.message);
      if (error) throw new Error(error.message);
      res.json({
        rows: data ?? [],
        total: count ?? 0,
        counts: {
          all: all.count ?? 0,
          phone: phone.count ?? 0,
          social: social.count ?? 0,
        },
        ...status(),
      });
    }),
  );
  app.patch(
    "/api/local-businesses/:id",
    route(async (req, res) => {
      const input = z
        .object({
          stage: z.enum(localStages as [string, ...string[]]).optional(),
          notes: z.string().max(4000).optional(),
          suppressed: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      const row = await checked(
        db()
          .from("local_businesses")
          .update({ ...input, updated_at: now() })
          .eq("organization_id", res.locals.org)
          .eq("id", uuid.parse(req.params.id))
          .select(columns)
          .single(),
      );
      res.json(row);
    }),
  );
  app.get(
    "/api/local-searches",
    route(async (_req, res) => {
      const searches = await checked(
        db()
          .from("local_searches")
          .select("id,trades,cities,countries,per_city,created_at")
          .eq("organization_id", res.locals.org)
          .order("created_at", { ascending: false })
          .limit(5),
      );
      const saved = searches.length
        ? await checked(
            db()
              .from("local_businesses")
              .select("search_id")
              .eq("organization_id", res.locals.org)
              .in(
                "search_id",
                searches.map((s: { id: string }) => s.id),
              )
              .limit(5000),
          )
        : [];
      const count = new Map<string, number>();
      for (const r of saved as { search_id: string }[])
        count.set(r.search_id, (count.get(r.search_id) ?? 0) + 1);
      res.json({
        searches: searches.map((s: { id: string }) => ({
          ...s,
          saved: count.get(s.id) ?? 0,
        })),
      });
    }),
  );
  app.post(
    "/api/local-searches",
    route(async (req, res) => {
      admin(res);
      if (!geoapifyConfigured())
        return res.status(409).json({
          error:
            "Add GEOAPIFY_API_KEY to the server's .env, then restart the API and worker.",
        });
      const input = z
        .object({
          trades: z
            .array(
              z.enum(localTrades.map((t) => t.id) as [string, ...string[]]),
            )
            .min(1)
            .max(maxSearchTrades)
            .transform((t) => [...new Set(t)]),
          countries: z
            .array(z.enum(localCountries as [Country, ...Country[]]))
            .min(1)
            .max(4)
            .transform((c) => [...new Set(c)]),
          cities: z
            .array(z.string().trim().min(2).max(80))
            .max(10)
            .default([])
            .transform((c) => [...new Set(c)]),
          per_city: z.coerce.number().int().min(1).max(50).default(20),
        })
        .parse(req.body);
      const settings = await checked(
        db()
          .from("app_settings")
          .select("config")
          .eq("organization_id", res.locals.org)
          .maybeSingle(),
      );
      const search = await checked(
        db()
          .from("local_searches")
          .insert({
            organization_id: res.locals.org,
            ...input,
            created_by: res.locals.user.id,
          })
          .select("id,trades,cities,countries,per_city,created_at")
          .single(),
      );
      const names = input.trades.map((t) => localTrade(t)!.label);
      const config: LocalSearchConfig = {
        name: `${names.length === 1 ? names[0] : `${names.length} trades`} in ${input.cities.length ? input.cities.join(", ") : `the biggest cities of ${input.countries.join(", ")}`}`,
        provider: "geoapify",
        search_id: search.id,
        trades: input.trades,
        cities: input.cities,
        countries: input.countries,
        per_city: input.per_city,
        daily_api_budget: Number(settings?.config?.daily_api_budget) || 100,
      };
      const job = await enqueue(
        res.locals.org,
        "discovery",
        `local:${search.id}`,
        { kind: "local", config, search_id: search.id },
      );
      res.status(202).json({ search, job });
    }),
  );
}
