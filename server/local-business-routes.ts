import type { Express, Response, Request, NextFunction } from "express";
import { z } from "zod";
import { db, checked, now } from "./lib/db.js";
import { uuid } from "./lib/validation.js";
import { enqueue } from "./pipeline.js";
import { geoapifyConfigured } from "./modules/geoapify.js";
import { websiteSearchProvider } from "./modules/web-check.js";
import type { LocalSearchConfig } from "./modules/local-discovery.js";
import {
  localStages,
  localTrade,
  localTrades,
} from "../shared/local-business.js";

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
          page: z.coerce.number().int().min(0).max(1000).default(0),
          size: z.coerce.number().int().min(5).max(50).default(20),
        })
        .parse(req.query);
      let query = db()
        .from("local_businesses")
        .select(columns, { count: "exact" })
        .eq("organization_id", res.locals.org)
        .eq("suppressed", false);
      if (input.view === "no_site")
        query = query.in("website_check", ["no_site_found", "not_checked"]);
      if (input.q) {
        const like = `%${input.q.replace(/[%_,()\\]/g, " ")}%`;
        query = query.or(
          `name.ilike.${like},city.ilike.${like},trade.ilike.${like}`,
        );
      }
      const { data, count, error } = await query
        .order("found_at", { ascending: false })
        .range(
          input.page * input.size,
          input.page * input.size + input.size - 1,
        );
      if (error) throw new Error(error.message);
      res.json({ rows: data ?? [], total: count ?? 0, ...status() });
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
          trade: z.enum(localTrades.map((t) => t.id) as [string, ...string[]]),
          cities: z
            .array(z.string().trim().min(2).max(80))
            .min(1)
            .max(10)
            .transform((c) => [...new Set(c)]),
          country: z.enum(["US", "GB", "CA", "AU"]),
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
          .select("id,trade,cities,country,per_city,created_at")
          .single(),
      );
      const config: LocalSearchConfig = {
        name: `${localTrade(input.trade)!.label} in ${input.cities.join(", ")}`,
        provider: "geoapify",
        search_id: search.id,
        trade: input.trade,
        cities: input.cities,
        country: input.country,
        per_city: input.per_city,
        daily_api_budget: Number(settings?.config?.daily_api_budget) || 100,
      };
      const job = await enqueue(
        res.locals.org,
        "discovery",
        `local:${search.id}`,
        {
          kind: "local",
          config,
          search_id: search.id,
        },
      );
      res.status(202).json({ search, job });
    }),
  );
}
