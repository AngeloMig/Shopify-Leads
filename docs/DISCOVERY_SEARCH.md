# Discovery search and saved candidates

Migrations through `009_candidate_recovery.sql` and the updated API/worker enable these features for saved Tavily campaigns. Existing discovery limits, audit limits, schedules, Shopify verification and country checks still apply. Other providers retain their existing adapters.

## Use more of each search

Each successful Tavily response, its rotation cursor and all normalized candidate domains are saved in one database transaction. Discovery first checks eligible saved candidates for that campaign. It makes another search only when no saved candidate is eligible, the store target is unmet and the run still has search allowance. A response with 20 candidates can therefore supply several three-store runs, if enough stores pass verification. Fewer can qualify. Audits still reserve their own provider requests.

Unused candidates stay pending. Completed/researched stores and suppression records remain protected by full retained workspace history. Legacy recent-domain cursor lists are discarded because they mixed checked and unchecked domains. Old responses did not retain their unused candidate details, so they cannot be reconstructed; the saved queue begins with new responses after this update.

Parent-job and candidate ownership are checked before saving or claiming work. Orphaned checks from cancelled or expired parent jobs are shown as saved candidates and can be reclaimed; late writes from the former owner are fenced out. Persisted child audits enforce the store limit after a restart. Retrying a stored response sequence does not reset checked candidates or duplicate its search event. Cancellation prevents new child audits and checkpoint writes. An interruption between receiving an external response and persisting it can still lose that response or count a repeated request; external requests and the database are not one transaction.

## Search selection

Six formats combine focused phrases with online shops, independent Shopify stores, Shopify footer phrases, product collections, regional stores and local brands. Country/industry combinations rotate before advancing the keyword. Regions are search hints, never evidence of business location.

When learning is enabled, every fourth search may reuse an eligible query that has already produced a published audit. The other searches continue exploring. The ranking is `(published audits + 2 × business/support contacts + 10 × clients won − 2 × stores marked not a fit) / search credits`, using up to the latest 1,000 campaign searches. Early results are small samples, not guaranteed productivity. Missing reported credit usage falls back to the basic-search estimate and is labelled accordingly. Old searches retain the `legacy` format and do not enter format exploitation.

Candidate priority uses product/collection paths, merchant phrases and provider relevance to decide which site to check first. Publisher/agency indicators lower priority; they do not silently discard a potentially valid merchant. Actual eligibility still comes from guarded storefront checks.

## Exclusions and cooldowns

Manual exclusions come first, followed by built-in irrelevant sources and recent researched/suppressed/cooling-down domains. The combined, normalized, deduplicated Tavily list is capped at 150 domains. Database history still checks every candidate even when a domain cannot fit in the provider list.

## Public catalog and ideal client

Stores showing any Shopify evidence get one extra request to `/products.json`, following the same robots, DNS and size rules as other crawling. A valid feed counts as Shopify evidence and supplies product count, typical price and product dates. Private or missing feeds stay unknown and are never rejected for that.

A campaign can set an optional ideal client: product count, typical price and how recently a product was added. Stores outside it are set aside before any PageSpeed request, with a 7-day cooldown scoped to the campaign's countries. Manually requested audits are not blocked. Prices use each store's own currency, because the public feed does not state one.

Rejected domains retain their source reason and retry eligibility:

| Reason                                                                | Cooldown                                  |
| --------------------------------------------------------------------- | ----------------------------------------- |
| Temporary outage, timeout, unavailable DNS or HTTP 429/5xx            | 1 day                                     |
| Robots denial, crawl restriction or HTTP 401/403                      | 7 days                                    |
| Business-country mismatch                                             | 14 days, scoped to the target-country set |
| Outside the campaign's ideal client                                   | 7 days, scoped to the target-country set  |
| Insufficient Shopify/activity evidence or other non-storefront result | 30 days                                   |

Unverified country evidence goes to the existing manual review queue. Robots restrictions are never bypassed. Checks are capped at 60 candidates per discovery job, in addition to the store/search limits. Expired rejection records are removed 30 days after their cooldown; completed search/pool history follows the configured research retention period.

## Dashboard

In Settings or Store Discovery, select a saved campaign. Saved candidate counts show unchecked, active and cooling-down records. Expand Search performance for per-query returned results, duplicates, previously researched stores, unused candidates, Shopify checks, audits queued, published audits, business/support contacts and reported/estimated search credits. Ten searches appear per page within the latest 1,000.

Published audits are attributed to their actual source search, including candidates used by a later job. Historical audit attribution is backfilled only where a single report matches the job's store and execution window. Unrecorded duplicate counts and unmeasured credit counts are labelled. Contact counts indicate publicly published addresses, not mailbox deliverability or permission to send outreach.
