import { useEffect, useState, type FormEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  HardHat,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  localCountries,
  localStages,
  localTradePresets,
  localTrades,
  maxSearchTrades,
  socialLabel,
  websiteCheckLabel,
  type LocalBusiness,
  type LocalSearch,
  type LocalStage,
} from "../../shared/local-business";
import { countryNames, type Country } from "../../shared/types";
import { demoLocalBusinesses, demoLocalSearches } from "../demo";
import { api, formatDate } from "../lib";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import "../local-businesses.css";

type View = "no_site" | "all";
type Status = {
  geoapify_configured: boolean;
  website_check: "tavily" | "brave" | null;
};
const pageSize = 20;
const stageLabel: Record<LocalStage, string> = {
  new: "New",
  contacted: "Contacted",
  won: "Won",
  lost: "Lost",
};
const mapUrl = (b: LocalBusiness) =>
  b.osm_url ??
  (b.lat != null && b.lon != null
    ? `https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lon}#map=18/${b.lat}/${b.lon}`
    : null);
const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function Attribution() {
  return (
    <span className="local-attribution">
      Powered by{" "}
      <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">
        Geoapify
      </a>{" "}
      ·{" "}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap contributors
      </a>
    </span>
  );
}

export function LocalBusinesses({
  demo,
  notify,
}: {
  demo: boolean;
  notify: (message: string) => void;
}) {
  const [view, setView] = useState<View>("no_site"),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<LocalBusiness[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(!demo),
    [error, setError] = useState(""),
    [status, setStatus] = useState<Status>({
      geoapify_configured: true,
      website_check: "tavily",
    }),
    [open, setOpen] = useState<LocalBusiness | null>(null),
    [revision, setRevision] = useState(0),
    [recent, setRecent] = useState<LocalSearch[]>(
      demo ? demoLocalSearches : [],
    );

  useEffect(() => {
    if (demo) return;
    let current = true;
    api<{ searches: LocalSearch[] }>("/local-searches")
      .then((r) => current && setRecent(r.searches))
      .catch(() => {
        /* Recent searches are a shortcut; the form works without them. */
      });
    return () => {
      current = false;
    };
  }, [demo, revision]);

  useEffect(() => {
    if (demo) {
      const list = demoLocalBusinesses.filter(
        (b) => view === "all" || b.website_check !== "site_found",
      );
      setRows(list.slice(page * pageSize, page * pageSize + pageSize));
      setTotal(list.length);
      return;
    }
    let current = true;
    setLoading(true);
    setError("");
    api<{ rows: LocalBusiness[]; total: number } & Status>(
      `/local-businesses?view=${view}&page=${page}&size=${pageSize}`,
    )
      .then((r) => {
        if (!current) return;
        setRows(r.rows);
        setTotal(r.total);
        setStatus({
          geoapify_configured: r.geoapify_configured,
          website_check: r.website_check,
        });
      })
      .catch((e) => current && setError((e as Error).message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [demo, view, page, revision]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <LocalSearchForm
        demo={demo}
        status={status}
        recent={recent}
        onQueued={() => {
          notify("Search queued. Track it in Automation jobs.");
          setTimeout(() => setRevision((n) => n + 1), 4000);
        }}
      />
      <section className="panel local-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Local businesses <span className="count-badge">{total}</span>
            </h2>
            <p>
              Businesses on the map with no website listed, checked against a
              web search.
            </p>
          </div>
        </div>
        <div className="table-toolbar">
          <div className="table-tabs" role="tablist">
            {(
              [
                ["no_site", "No website"],
                ["all", "All checked"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={view === id}
                className={view === id ? "active" : ""}
                onClick={() => {
                  setView(id);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {error ? (
          <div className="empty-state">
            <p className="error-message">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRevision((n) => n + 1)}
            >
              Try again
            </Button>
          </div>
        ) : !loading && rows.length === 0 ? (
          <div className="empty-state">
            <HardHat size={24} />
            <p>
              No local businesses yet. Pick a trade and a few cities to find
              businesses with no website.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="local-table" aria-busy={loading}>
              <thead>
                <tr>
                  <th>Business</th>
                  <th>City</th>
                  <th>Phone</th>
                  <th>Website</th>
                  <th>Social</th>
                  <th>Stage</th>
                  <th>Found</th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0
                  ? Array.from({ length: 4 }, (_, i) => (
                      <tr key={i} className="pipeline-skeleton-row">
                        <td colSpan={7}>
                          <span className="pipeline-skeleton-line" />
                        </td>
                      </tr>
                    ))
                  : rows.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <button
                            className="local-name"
                            onClick={() => setOpen(b)}
                          >
                            <strong>{b.name}</strong>
                            <small>{b.trade}</small>
                          </button>
                        </td>
                        <td>{b.city}</td>
                        <td>
                          {b.phone ? (
                            <a className="local-phone" href={tel(b.phone)}>
                              {b.phone}
                            </a>
                          ) : (
                            <span className="unknown">Not listed</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`local-check local-check-${b.website_check}`}
                          >
                            {websiteCheckLabel[b.website_check]}
                          </span>
                        </td>
                        <td>
                          {b.social_links.length ? (
                            <span className="local-social">
                              {b.social_links.map((s) => (
                                <a
                                  key={s.url}
                                  href={s.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {socialLabel[s.network]}
                                </a>
                              ))}
                            </span>
                          ) : (
                            <span className="unknown">None found</span>
                          )}
                        </td>
                        <td>{stageLabel[b.stage]}</td>
                        <td>{formatDate(b.found_at, true)}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <Attribution />
          <div className="pagination">
            <span>
              Page {page + 1} of {pages}
            </span>
            <button
              className="icon-button"
              aria-label="Previous page"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Next page"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>
      {open && (
        <LocalBusinessDetail
          key={open.id}
          lead={open}
          demo={demo}
          onClose={() => setOpen(null)}
          onSaved={(b) => {
            setRows((r) => r.map((x) => (x.id === b.id ? b : x)));
            setOpen(b);
            notify("Saved");
          }}
        />
      )}
    </>
  );
}

const cityExamples: Record<Country, string> = {
  US: "Austin, TX",
  GB: "Manchester",
  CA: "Toronto, ON",
  AU: "Brisbane, QLD",
};
const countryShort: Record<Country, string> = {
  US: "US",
  GB: "UK",
  CA: "Canada",
  AU: "Australia",
};
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
const tradeLabel = (id: string) =>
  localTrades.find((t) => t.id === id)?.label ?? id;

/** What a search will cost, shown before it runs. */
function estimate(
  trades: string[],
  areas: number,
  cities: number,
  perPlace: number,
) {
  const chosen = localTrades.filter((t) => trades.includes(t.id));
  const kinds =
    Number(chosen.some((t) => t.categories.length)) +
    Number(chosen.some((t) => t.broad));
  return {
    requests: areas * kinds + cities,
    businesses: chosen.length * areas * perPlace,
    byName: chosen.some((t) => t.broad && !t.categories.length),
  };
}

function LocalSearchForm({
  demo,
  status,
  recent,
  onQueued,
}: {
  demo: boolean;
  status: Status;
  recent: LocalSearch[];
  onQueued: () => void;
}) {
  const [trades, setTrades] = useState<string[]>(["construction"]),
    [query, setQuery] = useState(""),
    [countries, setCountries] = useState<Country[]>(["US"]),
    [mode, setMode] = useState<"country" | "cities">("cities"),
    [cities, setCities] = useState(""),
    [perPlace, setPerPlace] = useState(20),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const list =
    mode === "cities"
      ? cities
          .split(/[\n;]+/)
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
  const areas = mode === "cities" ? list.length : countries.length;
  const cost = estimate(trades, areas, list.length, perPlace);
  const full = trades.length >= maxSearchTrades;
  const groups = [...new Set(localTrades.map((t) => t.group))];
  const q = query.trim().toLowerCase();
  const matches = q
    ? localTrades.filter(
        (t) =>
          t.label.toLowerCase().includes(q) ||
          t.group.toLowerCase().includes(q),
      )
    : [];
  const toggleTrade = (id: string) =>
    setTrades((on) =>
      on.includes(id)
        ? on.filter((t) => t !== id)
        : on.length < maxSearchTrades
          ? [...on, id]
          : on,
    );
  const togglePreset = (ids: string[]) =>
    setTrades((on) =>
      ids.every((id) => on.includes(id))
        ? on.filter((t) => !ids.includes(t))
        : [...on, ...ids.filter((id) => !on.includes(id))].slice(
            0,
            maxSearchTrades,
          ),
    );
  const toggleCountry = (c: Country) =>
    setCountries((on) =>
      on.includes(c) ? on.filter((x) => x !== c) : [...on, c],
    );
  async function run(
    body: {
      trades: string[];
      countries: Country[];
      cities: string[];
      per_city: number;
    },
    key: string,
  ) {
    setBusy(key);
    setError("");
    try {
      await api("/local-searches", body);
      onQueued();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const blocked = demo || !status.geoapify_configured;
  const ready =
    trades.length > 0 &&
    countries.length > 0 &&
    (mode === "country" || (list.length > 0 && list.length <= 10));
  const option = (t: (typeof localTrades)[number]) => (
    <label key={t.id} className="local-check-option">
      <input
        type="checkbox"
        checked={trades.includes(t.id)}
        disabled={!trades.includes(t.id) && full}
        onChange={() => toggleTrade(t.id)}
      />
      {t.label}
    </label>
  );
  return (
    <form
      className="panel local-search"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          { trades, countries, cities: list, per_city: perPlace },
          "new",
        );
      }}
    >
      <div className="local-search-head">
        <h2>Find businesses without a website</h2>
        <p>
          Searches OpenStreetMap through Geoapify's free plan, then runs one web
          search for each business with no website listed.
        </p>
      </div>

      <section className="local-step">
        <h3>
          <span>1</span>What are you looking for?
          <small>
            {trades.length}/{maxSearchTrades} trades
          </small>
        </h3>
        <div className="local-presets" aria-label="Quick picks">
          {localTradePresets.map((p) => {
            const on = p.trades.every((id) => trades.includes(id));
            return (
              <button
                type="button"
                key={p.label}
                className="local-chip"
                aria-pressed={on}
                onClick={() => togglePreset(p.trades)}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        {trades.length > 0 && (
          <div className="local-selected" aria-label="Chosen trades">
            {trades.map((id) => (
              <span key={id} className="local-pick">
                {tradeLabel(id)}
                <button
                  type="button"
                  aria-label={`Remove ${tradeLabel(id)}`}
                  onClick={() => toggleTrade(id)}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="text-button"
              onClick={() => setTrades([])}
            >
              Clear all
            </button>
          </div>
        )}
        <label className="search-input local-trade-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 57 trades, e.g. roofer, vet, bakery"
            aria-label="Search trades"
          />
        </label>
        {q ? (
          <div className="local-trade-results">
            {matches.length ? (
              matches.map(option)
            ) : (
              <span className="unknown">No trade matches “{query}”.</span>
            )}
          </div>
        ) : (
          <div className="local-trade-groups">
            {groups.map((g) => {
              const inGroup = localTrades.filter((t) => t.group === g);
              const picked = inGroup.filter((t) =>
                trades.includes(t.id),
              ).length;
              return (
                <details key={g}>
                  <summary>
                    {g}
                    <small>
                      {picked ? `${picked} chosen` : inGroup.length}
                    </small>
                  </summary>
                  <div className="local-trade-options">
                    {inGroup.map(option)}
                  </div>
                </details>
              );
            })}
          </div>
        )}
        {full && (
          <small className="local-hint">
            That's the most for one search. Run it, then pick the next set.
          </small>
        )}
      </section>

      <section className="local-step">
        <h3>
          <span>2</span>Where?
        </h3>
        <div className="local-presets" aria-label="Countries">
          {localCountries.map((c) => (
            <button
              type="button"
              key={c}
              className="local-chip"
              aria-pressed={countries.includes(c)}
              onClick={() => toggleCountry(c)}
            >
              {countryNames[c]}
            </button>
          ))}
        </div>
        <div className="local-mode" role="radiogroup" aria-label="Search area">
          {(
            [
              ["cities", "Specific cities"],
              ["country", "Whole country"],
            ] as const
          ).map(([id, label]) => (
            <label key={id} className="local-check-option">
              <input
                type="radio"
                name="local-area"
                checked={mode === id}
                onChange={() => setMode(id)}
              />
              {label}
            </label>
          ))}
        </div>
        {mode === "cities" ? (
          <label className="field-label local-cities">
            Cities, one per line (up to 10)
            <textarea
              rows={3}
              value={cities}
              placeholder="One city per line"
              onChange={(e) => setCities(e.target.value)}
            />
            <small>
              For example:{" "}
              {(countries.length ? countries : localCountries)
                .map((c) => cityExamples[c])
                .join(" · ")}
              . Add the state or province to pick the right one.
            </small>
          </label>
        ) : (
          <small className="local-hint">
            Searches all of{" "}
            {countries.length
              ? countries.map((c) => countryShort[c]).join(", ")
              : "the chosen countries"}
            . Good for a first look; cities give more focused results.
          </small>
        )}
      </section>

      <section className="local-step">
        <h3>
          <span>3</span>How many?
        </h3>
        <p className="local-amount">
          Up to{" "}
          <select
            value={perPlace}
            onChange={(e) => setPerPlace(Number(e.target.value))}
            aria-label="Businesses per trade in each place"
          >
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>{" "}
          businesses per trade in each {mode === "cities" ? "city" : "country"}.
        </p>
      </section>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <div className="local-summary">
        <div>
          <strong>
            {demo
              ? "Sample data"
              : !status.geoapify_configured
                ? "Geoapify key needed"
                : ready
                  ? `${plural(trades.length, "trade")} · ${countries.map((c) => countryShort[c]).join(", ")} · ${mode === "cities" ? plural(list.length, "city", "cities") : "whole country"}`
                  : trades.length === 0
                    ? "Pick at least one trade"
                    : countries.length === 0
                      ? "Pick at least one country"
                      : list.length > 10
                        ? "Up to 10 cities per search"
                        : "Add at least one city"}
          </strong>
          <small>
            {demo
              ? "Connect your workspace to run a real search."
              : !status.geoapify_configured
                ? "Add GEOAPIFY_API_KEY to the server's .env, then restart the API and worker."
                : ready
                  ? [
                      `About ${plural(cost.requests, "map request")}, up to ${cost.businesses} businesses.`,
                      status.website_check
                        ? "Each web check uses one Tavily credit."
                        : "No web search is set up, so there's no website check.",
                      cost.byName
                        ? "Some trades are matched by business name."
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")
                  : "The cost shows here before you run it."}
          </small>
        </div>
        <Button type="submit" disabled={blocked || !ready || !!busy}>
          {busy === "new" ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Search size={16} />
          )}
          Find businesses
        </Button>
      </div>

      {recent.length > 0 && (
        <section className="local-recent">
          <h3>Recent searches</h3>
          <ul>
            {recent.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>
                    {r.trades.slice(0, 3).map(tradeLabel).join(", ")}
                    {r.trades.length > 3 && ` +${r.trades.length - 3} more`}
                  </strong>
                  <small>
                    {(r.cities.length
                      ? r.cities
                      : r.countries.map((c) => `All of ${countryShort[c]}`)
                    ).join(", ")}{" "}
                    · {formatDate(r.created_at, true)} ·{" "}
                    {plural(r.saved ?? 0, "business", "businesses")} saved
                  </small>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={blocked || !!busy}
                  onClick={() =>
                    void run(
                      {
                        trades: r.trades,
                        countries: r.countries,
                        cities: r.cities,
                        per_city: r.per_city,
                      },
                      r.id,
                    )
                  }
                >
                  {busy === r.id ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <RotateCcw size={14} />
                  )}
                  Run again
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </form>
  );
}

function LocalBusinessDetail({
  lead,
  demo,
  onClose,
  onSaved,
}: {
  lead: LocalBusiness;
  demo: boolean;
  onClose: () => void;
  onSaved: (b: LocalBusiness) => void;
}) {
  const [stage, setStage] = useState(lead.stage),
    [notes, setNotes] = useState(lead.notes),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      onSaved(
        demo
          ? { ...lead, stage, notes }
          : await api<LocalBusiness>(
              `/local-businesses/${lead.id}`,
              { stage, notes },
              "PATCH",
            ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const map = mapUrl(lead);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={lead.name}
      description={`${lead.trade} · ${lead.city}`}
    >
      <div className="local-detail">
        <section>
          <h3>Listing</h3>
          <ul className="local-facts">
            <li>
              <Phone size={14} />
              {lead.phone ? (
                <a href={tel(lead.phone)}>{lead.phone}</a>
              ) : (
                <span className="unknown">No phone listed</span>
              )}
            </li>
            {lead.email && (
              <li>
                <Mail size={14} />
                <a href={`mailto:${lead.email}`}>{lead.email}</a>
              </li>
            )}
            {lead.address && (
              <li>
                <MapPin size={14} />
                {lead.address}
              </li>
            )}
            {lead.opening_hours && (
              <li>
                <Clock3 size={14} />
                {lead.opening_hours}
              </li>
            )}
            {map && (
              <li>
                <ExternalLink size={14} />
                <a href={map} target="_blank" rel="noreferrer">
                  Open in OpenStreetMap
                </a>
              </li>
            )}
          </ul>
        </section>
        <section>
          <h3>Website check</h3>
          <p>
            <span className={`local-check local-check-${lead.website_check}`}>
              {websiteCheckLabel[lead.website_check]}
            </span>
          </p>
          <p className="local-note">
            {lead.website_check === "not_checked"
              ? "The map listing has no website. No web search was set up when it was found, so Scout hasn't looked further."
              : lead.website_check === "site_found"
                ? `A site that looks like theirs turned up: ${lead.found_site}.`
                : `The map listing has no website, and a web search for ${lead.check_query ?? "the business"} found none. That isn't proof they have none.`}
          </p>
          {lead.social_links.length > 0 && (
            <ul className="local-facts">
              {lead.social_links.map((s) => (
                <li key={s.url}>
                  <ExternalLink size={14} />
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {socialLabel[s.network]}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3>Your notes</h3>
          <label className="field-label">
            Stage
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as LocalStage)}
            >
              {localStages.map((s) => (
                <option key={s} value={s}>
                  {stageLabel[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Notes
            <textarea
              rows={3}
              maxLength={4000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <LoaderCircle className="spin" size={16} />}
            Save
          </Button>
        </section>
        <Attribution />
      </div>
    </Dialog>
  );
}
