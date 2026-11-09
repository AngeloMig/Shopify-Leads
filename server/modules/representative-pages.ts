import { CrawlSession } from "../lib/network.js";
import { JobError } from "../lib/job-errors.js";
import { inspectHtml, type PageEvidence } from "./html-audit.js";

export type PageLimitation = { url: string; kind: string; reason: string };
/**
 * Secondary pages may be unavailable. A site that keeps rate limiting after the
 * crawl's own backoff gets its remaining pages skipped and disclosed, since the
 * homepage evidence and measurements are already saved. The homepage, server
 * outages and lease loss remain strict.
 */
export async function scanRepresentativePages(
  crawl: Pick<CrawlSession, "fetch">,
  homepage: PageEvidence,
  options: {
    checkpoint: () => Promise<void>;
    onAttempt?: (url: string, kind: string) => Promise<void>;
    onComplete?: (
      page: PageEvidence & { http_status: number; requested_url: string },
    ) => Promise<void>;
    onSkipped?: (page: PageLimitation) => Promise<void>;
  },
) {
  const pages: (PageEvidence & { http_status: number })[] = [];
  const skipped: PageLimitation[] = [];
  const seen = new Set([homepage.url]);
  let rateLimited = false;
  for (const [kind, pattern] of [
    ["collection", /\/collections\/[^/?]+/],
    ["product", /\/products\/[^/?]+/],
    ["contact", /\/((pages\/)?contact)/],
    ["about", /\/((pages\/)?about)/],
  ] as const) {
    const candidates = [
      ...new Set(
        homepage.links.filter((url) => pattern.test(new URL(url).pathname)),
      ),
    ].slice(0, 2);
    for (const url of candidates) {
      if (seen.has(url)) continue;
      seen.add(url);
      await options.checkpoint();
      if (rateLimited) {
        const limitation = {
          url,
          kind,
          reason: "Not requested: the site was rate limiting this review",
        };
        skipped.push(limitation);
        await options.onSkipped?.(limitation);
        break;
      }
      await options.onAttempt?.(url, kind);
      let response;
      try {
        response = await crawl.fetch(url);
        if ([401, 403, 404, 410].includes(response.status))
          throw new JobError(
            `Page unavailable (HTTP ${response.status})`,
            "optional_page",
          );
        if (response.status >= 400)
          throw new JobError(
            `Representative ${kind} page returned HTTP ${response.status}`,
            "temporary",
          );
        if (!response.headers["content-type"]?.includes("text/html"))
          throw new JobError("Page did not return HTML", "optional_page");
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "Page unavailable";
        if (error instanceof JobError && error.code === "rate_limit")
          rateLimited = true;
        const optional =
          error instanceof JobError
            ? error.code === "optional_page" ||
              error.code === "rate_limit" ||
              error.code === "too_large"
            : /Crawling disallowed by robots\.txt|Robots rules unavailable \((401|403)\)|Requested crawl delay exceeds worker limit/i.test(
                reason,
              );
        if (!optional) throw error;
        const limitation = { url, kind, reason };
        skipped.push(limitation);
        await options.checkpoint();
        await options.onSkipped?.(limitation);
        if (rateLimited) break;
        continue;
      }
      await options.checkpoint();
      if (!seen.has(response.url) || response.url === url) {
        seen.add(response.url);
        const page = {
          ...inspectHtml(response.body.toString(), response.url, kind),
          http_status: response.status,
        };
        pages.push(page);
        await options.onComplete?.({ ...page, requested_url: url });
      } else {
        await options.onSkipped?.({
          url,
          kind,
          reason: "Redirected to an already reviewed page",
        });
      }
      break;
    }
  }
  return { pages, skipped, rateLimited };
}
