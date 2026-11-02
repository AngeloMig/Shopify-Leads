/** Largest page Shopify's public product feed returns; a full page means "at least". */
export const catalogPageSize = 250;
export type CatalogEvidence = {
  source_url: string;
  observed_at: string;
  product_count: number;
  /** True when the count is one full page, so the real catalog may be larger. */
  count_capped: boolean;
  newest_published_at: string | null;
  last_updated_at: string | null;
  /** In the store's own currency, which the public feed does not state. */
  median_price: number | null;
  min_price: number | null;
  max_price: number | null;
};
export type IdealClient = {
  min_products?: number | null;
  max_products?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  active_within_days?: number | null;
};
export type FitResult = {
  status: "fits" | "outside" | "unknown" | "not_set";
  reasons: string[];
};
const day = 86400000;
const latest = (values: unknown[]) => {
  const times = values
    .map((value) => (typeof value === "string" ? Date.parse(value) : NaN))
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
};
/** Returns null unless the response really has the shape of a Shopify product feed. */
export function summarizeCatalog(
  json: unknown,
  source_url: string,
  observed_at = new Date().toISOString(),
): CatalogEvidence | null {
  const products = (json as { products?: unknown } | null)?.products;
  if (!Array.isArray(products)) return null;
  const rows = products.filter(
    (p): p is Record<string, unknown> =>
      !!p &&
      typeof p === "object" &&
      typeof (p as Record<string, unknown>).handle === "string" &&
      Array.isArray((p as Record<string, unknown>).variants),
  );
  if (rows.length !== products.length) return null;
  const prices = rows
    .map((p) => Number((p.variants as Record<string, unknown>[])[0]?.price))
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  return {
    source_url,
    observed_at,
    product_count: rows.length,
    count_capped: rows.length >= catalogPageSize,
    newest_published_at: latest(rows.map((p) => p.published_at)),
    last_updated_at: latest(rows.map((p) => p.updated_at)),
    median_price: prices.length ? prices[Math.floor(prices.length / 2)] : null,
    min_price: prices[0] ?? null,
    max_price: prices.at(-1) ?? null,
  };
}
export const daysSince = (iso: string | null | undefined, at = Date.now()) =>
  iso ? Math.max(0, Math.floor((at - Date.parse(iso)) / day)) : null;
const set = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);
/**
 * Compare a store with a campaign's ideal client. Unknown data stays unknown: a
 * store is only "outside" on evidence, never because its catalog is private.
 */
export function evaluateFit(
  catalog: CatalogEvidence | null | undefined,
  ideal: IdealClient | null | undefined,
  at = Date.now(),
): FitResult {
  const i = ideal ?? {};
  if (
    ![
      i.min_products,
      i.max_products,
      i.min_price,
      i.max_price,
      i.active_within_days,
    ].some(set)
  )
    return { status: "not_set", reasons: [] };
  if (!catalog)
    return {
      status: "unknown",
      reasons: ["The store's public catalog could not be read."],
    };
  const reasons: string[] = [];
  const count = `${catalog.product_count}${catalog.count_capped ? "+" : ""} products`;
  if (set(i.min_products) && catalog.product_count < i.min_products)
    reasons.push(`${count}, below the ${i.min_products} minimum`);
  if (set(i.max_products) && catalog.product_count > i.max_products)
    reasons.push(`${count}, above the ${i.max_products} maximum`);
  if (catalog.median_price !== null) {
    if (set(i.min_price) && catalog.median_price < i.min_price)
      reasons.push(
        `typical price ${catalog.median_price}, below the ${i.min_price} minimum`,
      );
    if (set(i.max_price) && catalog.median_price > i.max_price)
      reasons.push(
        `typical price ${catalog.median_price}, above the ${i.max_price} maximum`,
      );
  }
  const age = daysSince(catalog.newest_published_at, at);
  if (set(i.active_within_days) && age !== null && age > i.active_within_days)
    reasons.push(
      `newest product is ${age} days old, past the ${i.active_within_days}-day limit`,
    );
  return reasons.length
    ? { status: "outside", reasons }
    : { status: "fits", reasons: [] };
}
