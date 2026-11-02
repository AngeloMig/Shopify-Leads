import { useEffect, useMemo, useState } from "react";
import { api } from "../lib";
import {
  countryNames,
  type DiscoverySettings,
  type Country,
} from "../../shared/types";
import { Button } from "./ui/button";
import { queryPerformance } from "../../shared/discovery-search";
type Candidate = {
  id: string;
  domain: string;
  name: string;
  reason: string;
  source_url: string;
};
type Search = {
  id: string;
  query: string;
  keyword: string;
  country: string;
  returned: number;
  checked: number;
  verified: number;
  queued: number;
  previously_researched: number;
  credits: number;
  completed_audits: number;
  suitable_contacts: number;
  won_leads?: number;
  industry: string;
  format: string;
  credits_measured: boolean;
  duplicate_results: number;
  duplicate_results_recorded: boolean;
  saved_candidates: number;
  rejected: number;
};
export function DiscoveryWorkbench({
  live,
  campaigns,
  selected,
  onSelect,
  onNew,
}: {
  live: boolean;
  campaigns: DiscoverySettings[];
  selected: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [data, setData] = useState<{
      candidates: Candidate[];
      searches: Search[];
      pool: {
        pending: number;
        checking: number;
        cooling_down: number;
        review: number;
      };
    } | null>(null),
    [error, setError] = useState(""),
    [review, setReview] = useState(""),
    [country, setCountry] = useState<Country>("US"),
    [source, setSource] = useState(""),
    [evidence, setEvidence] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [searchPage, setSearchPage] = useState(0);
  useEffect(() => {
    if (!live) return;
    let active = true;
    setData(null);
    setError("");
    setSearchPage(0);
    void api<{
      candidates: Candidate[];
      searches: Search[];
      pool: {
        pending: number;
        checking: number;
        cooling_down: number;
        review: number;
      };
    }>(
      `/discovery/insights${selected && selected !== "new" ? `?campaign=${encodeURIComponent(selected)}` : ""}`,
    )
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [live, revision, selected]);
  const performance = useMemo(
    () => queryPerformance(data?.searches ?? []),
    [data],
  );
  const searchPages = Math.max(1, Math.ceil((data?.searches.length ?? 0) / 10));
  async function decide(id: string, status: "dismissed" | "verified") {
    setBusy(true);
    setError("");
    try {
      await api(
        `/candidates/${id}/review`,
        status === "dismissed"
          ? { status }
          : { status, country, source_url: source, evidence },
      );
      setReview("");
      setRevision((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel discovery-workbench">
      <div className="panel-heading">
        <div>
          <h2>Focused campaigns</h2>
          <p>Give each niche its own countries, keywords and search history.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onNew}>
          New campaign
        </Button>
      </div>
      <div className="campaign-picker">
        <label className="field-label">
          Edit or run a campaign
          <select value={selected} onChange={(e) => onSelect(e.target.value)}>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.enabled ? " · scheduled" : ""}
              </option>
            ))}
            {(selected === "new" || !campaigns.length) && (
              <option value="new">New focused campaign</option>
            )}
          </select>
        </label>
        <p>
          Saving updates the selected campaign. New campaigns start with
          scheduling off. Use Run saved configuration after saving.
        </p>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {live && (
        <div
          className="search-pool-overview"
          aria-label="Saved discovery candidates"
        >
          <div>
            <strong>{data?.pool.pending ?? "—"}</strong>
            <span>Saved unchecked</span>
          </div>
          <div>
            <strong>{data?.pool.cooling_down ?? "—"}</strong>
            <span>On cooldown</span>
          </div>
          <div>
            <strong>{data?.pool.checking ?? "—"}</strong>
            <span>Being checked</span>
          </div>
          <p>
            Discovery checks saved candidates for the selected campaign before
            making another search. Candidates still need Shopify, activity and
            country verification.
          </p>
        </div>
      )}
      <details className="campaign-insights">
        <summary>
          Search performance · {data?.searches.length ?? "…"} recorded{" "}
          {data?.searches.length === 1 ? "search" : "searches"}
        </summary>
        <p>
          Latest 1,000 searches for the selected campaign. Published audits are
          linked to their source query, including audits from candidates saved
          for later. Contacts are public business/support addresses, not
          outreach approval. Unmeasured credit counts are estimates; historical
          duplicate counts may be unrecorded.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRevision((x) => x + 1)}
        >
          Refresh search results
        </Button>
        <details className="query-learning">
          <summary>How search learns</summary>
          <p>
            Six formats rotate niche phrases, store searches and regional terms.
            Every fourth search may reuse a query that produced a published
            audit; the others explore. Learning favors clients won, then
            business/support contacts and published audits per credit. Regional
            terms never establish a store’s business country.
          </p>
        </details>
        {!!performance.length && (
          <details className="query-learning">
            <summary>Query yield · top 10 combinations</summary>
            <div className="table-scroll">
              <table>
                <caption>
                  Ranked by (published audits + 2 × business/support contacts +
                  10 × clients won − 2 × stores marked not a fit) ÷ search
                  credits. Small samples are early signals.
                </caption>
                <thead>
                  <tr>
                    <th>Phrase / format</th>
                    <th>Searches</th>
                    <th>Published</th>
                    <th>With contact</th>
                    <th>Won</th>
                    <th>Yield</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.slice(0, 10).map((p) => (
                    <tr
                      key={JSON.stringify([
                        p.country,
                        p.industry,
                        p.keyword,
                        p.format,
                      ])}
                    >
                      <td>
                        {p.keyword} · {p.country}
                        <small>{p.format}</small>
                      </td>
                      <td>{p.searches}</td>
                      <td>{p.completed_audits}</td>
                      <td>{p.suitable_contacts}</td>
                      <td>{p.won_leads}</td>
                      <td>{p.yield.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        {data?.searches.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Search</th>
                  <th>Results</th>
                  <th>Duplicates / researched</th>
                  <th>Saved unchecked</th>
                  <th>Shopify verified</th>
                  <th>Audits queued</th>
                  <th>Completed audits</th>
                  <th>Business/support contact</th>
                  <th>Search credits</th>
                </tr>
              </thead>
              <tbody>
                {data.searches
                  .slice(searchPage * 10, (searchPage + 1) * 10)
                  .map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>
                          {s.keyword} · {s.country}
                        </strong>
                        <small>
                          {s.format === "legacy"
                            ? "Earlier search format"
                            : s.format}
                        </small>
                        <details>
                          <summary>Query</summary>
                          {s.query}
                        </details>
                      </td>
                      <td>{s.returned}</td>
                      <td>
                        {s.duplicate_results_recorded
                          ? s.duplicate_results
                          : "Unrecorded"}{" "}
                        / {s.previously_researched}
                      </td>
                      <td>{s.saved_candidates}</td>
                      <td>{s.verified}</td>
                      <td>{s.queued}</td>
                      <td>{s.completed_audits}</td>
                      <td>{s.suitable_contacts}</td>
                      <td>
                        {s.credits}
                        {s.credits_measured ? "" : " (est.)"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            {!live
              ? "Connect a workspace to record search outcomes."
              : !data
                ? error
                  ? "Search history is unavailable. Use Refresh search results."
                  : "Loading search history…"
                : "No recorded searches yet. Your next discovery run will record them."}
          </p>
        )}
        {!!data?.searches.length && (
          <nav className="search-pagination" aria-label="Search result pages">
            <span>
              Page {searchPage + 1} of {searchPages} · {data.searches.length}{" "}
              {data.searches.length === 1 ? "search" : "searches"}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!searchPage}
              onClick={() => setSearchPage((p) => p - 1)}
            >
              Previous searches
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={searchPage + 1 >= searchPages}
              onClick={() => setSearchPage((p) => p + 1)}
            >
              Next searches
            </Button>
          </nav>
        )}
      </details>
      <details className="candidate-review">
        <summary>
          Country verification queue · {data?.candidates.length ?? 0} pending
        </summary>
        <p>
          These active Shopify candidates need country evidence before an audit.
          A search location does not establish a business’s country.
        </p>
        {data?.candidates.length ? (
          data.candidates.map((c) => (
            <article key={c.id}>
              <div>
                <strong>{c.domain}</strong>
                <p>{c.reason}</p>
                <a
                  href={`https://${c.domain}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Visit business website
                </a>
              </div>
              <div className="pipeline-actions">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setReview(c.id);
                    setSource("");
                    setEvidence("");
                  }}
                >
                  Review country
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void decide(c.id, "dismissed")}
                >
                  Dismiss
                </Button>
              </div>
              {review === c.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void decide(c.id, "verified");
                  }}
                >
                  <label className="field-label">
                    Business country
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value as Country)}
                    >
                      {Object.entries(countryNames).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Public evidence page
                    <input
                      type="url"
                      required
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      placeholder="https://store.com/pages/contact"
                    />
                  </label>
                  <label className="field-label">
                    What confirms the business location?
                    <textarea
                      required
                      minLength={20}
                      maxLength={1500}
                      rows={3}
                      value={evidence}
                      onChange={(e) => setEvidence(e.target.value)}
                      placeholder="Record the business address and what ties it to this store."
                    />
                  </label>
                  <p>
                    Saving records your manual evidence and queues an audit
                    using the campaign’s thresholds and budget.
                  </p>
                  <Button disabled={busy} type="submit">
                    Verify country & queue audit
                  </Button>
                </form>
              )}
            </article>
          ))
        ) : (
          <p>No candidates are waiting for country review.</p>
        )}
      </details>
    </section>
  );
}
