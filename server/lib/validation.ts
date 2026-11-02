import { z } from "zod";
import type { DiscoverySettings } from "../../shared/types.js";
// Threshold changes should not discard search rotation/recent-domain exclusions.
export function discoverySourceChanged(
  previous: DiscoverySettings,
  next: DiscoverySettings,
) {
  const source = (s: DiscoverySettings) =>
    JSON.stringify([
      s.provider,
      s.countries,
      s.industries,
      s.keywords,
      s.keyword_library ?? true,
    ]);
  return source(previous) !== source(next);
}
export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  provider: z.enum(["storeleads", "brave", "tavily"]),
  countries: z
    .array(z.enum(["US", "GB", "CA", "AU"]))
    .min(1)
    .max(4),
  industries: z.array(z.string().max(100)).max(12),
  keywords: z
    .string()
    .max(5000)
    .refine(
      (value) =>
        value.split(/[,;\n]+/).every((term) => term.trim().length <= 100),
      "Keep each keyword phrase under 101 characters",
    ),
  keyword_library: z.boolean().default(true),
  searches_per_run: z.number().int().min(1).max(3).default(1),
  batch_size: z.number().int().min(1).max(50),
  interval_hours: z.number().int().min(1).max(8760),
  enabled: z.boolean(),
  mobile_threshold: z.number().min(0).max(100),
  seo_threshold: z.number().min(0).max(100),
  modernization_threshold: z.number().min(0).max(100),
  retention_days: z.number().int().min(30).max(3650).default(365),
  daily_api_budget: z.number().int().min(1).max(10000),
  discovery_daily_budget: z.number().int().min(0).max(10000).optional(),
  audit_daily_budget: z.number().int().min(0).max(10000).optional(),
  max_audit_backlog: z.number().int().min(1).max(50).default(5),
  scheduled_runs_per_day: z.number().int().min(1).max(24).default(1),
  adaptive_queries: z.boolean().default(true),
  include_frontend_findings: z.boolean().default(true),
  ideal_client: z
    .object({
      min_products: z.number().int().min(0).max(100000).nullable().optional(),
      max_products: z.number().int().min(0).max(100000).nullable().optional(),
      min_price: z.number().min(0).max(1000000).nullable().optional(),
      max_price: z.number().min(0).max(1000000).nullable().optional(),
      active_within_days: z
        .number()
        .int()
        .min(1)
        .max(3650)
        .nullable()
        .optional(),
    })
    .strict()
    .refine(
      (i) =>
        (i.min_products ?? 0) <= (i.max_products ?? Infinity) &&
        (i.min_price ?? 0) <= (i.max_price ?? Infinity),
      "An ideal client minimum cannot be above its maximum",
    )
    .nullable()
    .optional(),
  excluded_domains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
    )
    .max(40)
    .default([]),
  history_months: z.union([
    z.literal(12),
    z.literal(24),
    z.literal(36),
    z.literal(60),
  ]),
  modules: z.object({
    browser: z.boolean(),
    history: z.boolean(),
    ai: z.boolean(),
  }),
});
export const uuid = z.string().uuid();
