import type { Express, Response, Request, NextFunction } from "express";
import { z } from "zod";
import { db, checked, now } from "./lib/db.js";
import { uuid } from "./lib/validation.js";
import { enqueue } from "./pipeline.js";
import { placeListing, placesConfigured } from "./modules/google-places.js";
import type { LocalSearchConfig } from "./modules/local-discovery.js";
import {
  localStages,
  type LocalBusiness,
  type PlaceListing,
} from "../shared/local-business.js";

const route =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
const columns =
  "id,place_id,trade,city,country,website_check,found_site,check_query,social_links,stage,notes,suppressed,found_at";

/** Google's listing for each row, fetched now and never saved. */
async function withListings(
  org: string,
  rows: Omit<LocalBusiness, "listing">[],
  level: "list" | "detail",
): Promise<LocalBusiness[]> {
  if (!placesConfigured())
    return rows.map((r) => ({
      ...r,
      listing: null,
      listing_error: "not_configured",
    }));
  return Promise.all(
    rows.map(async (r) => {
      const allowed = await checked(
        db().rpc("reserve_places_view", { org, budget: 300 }),
      );
      if (!allowed)
        return { ...r, listing: null, listing_error: "budget" as const };
      try {
        const listing: PlaceListing | null = await placeListing(
          r.place_id,
          level,
        );
        return {
          ...r,
          listing,
          ...(listing ? {} : { listing_error: "unavailable" as const }),
        };
      } catch {
        return { ...r, listing: null, listing_error: "unavailable" as const };
      }
    }),
  );
}

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
          page: z.coerce.number().int().min(0).max(1000).default(0),
          size: z.coerce.number().int().min(5).max(20).default(10),
        })
        .parse(req.query);
      let query = db()
        .from("local_businesses")
        .select(columns, { count: "exact" })
        .eq("organization_id", res.locals.org)
        .eq("suppressed", false);
      query =
        input.view === "no_site"
          ? query.in("website_check", ["no_site_found", "not_checked"])
          : query;
      const { data, count, error } = await query
        .order("found_at", { ascending: false })
        .range(
          input.page * input.size,
          input.page * input.size + input.size - 1,
        );
      if (error) throw new Error(error.message);
      res.json({
        rows: await withListings(res.locals.org, data ?? [], "list"),
        total: count ?? 0,
        places_configured: placesConfigured(),
      });
    }),
  );
  app.get(
    "/api/local-businesses/:id",
    route(async (req, res) => {
      const row = await checked(
        db()
          .from("local_businesses")
          .select(columns)
          .eq("organization_id", res.locals.org)
          .eq("id", uuid.parse(req.params.id))
          .single(),
      );
      const [lead] = await withListings(res.locals.org, [row], "detail");
      res.json(lead);
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
          .select("id,trade,cities,country,per_city,created_at")
          .eq("organization_id", res.locals.org)
          .order("created_at", { ascending: false })
          .limit(10),
      );
      res.json({ searches, places_configured: placesConfigured() });
    }),
  );
  app.post(
    "/api/local-searches",
    route(async (req, res) => {
      admin(res);
      if (!placesConfigured())
        return res.status(409).json({
          error:
            "Add GOOGLE_PLACES_API_KEY to the server's .env, then restart the API and worker.",
        });
      const input = z
        .object({
          trade: z.string().trim().min(2).max(80),
          cities: z
            .array(z.string().trim().min(2).max(80))
            .min(1)
            .max(10)
            .transform((c) => [...new Set(c)]),
          country: z.enum(["US", "GB", "CA", "AU"]),
          per_city: z.coerce.number().int().min(1).max(20).default(20),
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
        name: `${input.trade} in ${input.cities.join(", ")}`,
        provider: "google_places",
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
