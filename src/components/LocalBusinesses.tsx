import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowDownWideNarrow,
  AtSign,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  Search,
  Target,
  X,
} from "lucide-react";
import {
  localCountries,
  localStages,
  biggestCities,
  localTradePresets,
  localTrades,
  maxSearchTrades,
  tradeMatchesQuery,
  socialLabel,
  websiteCheckLabel,
  type LocalBusiness,
  type LocalSearch,
  type LocalStage,
} from "../../shared/local-business";
import {
  bestBetTrades,
  prospectScore,
  tierLabel,
  type Prospect,
} from "../../shared/local-prospect";
import { countryNames, type Country } from "../../shared/types";
import { demoLocalBusinesses, demoLocalSearches } from "../demo";
import { api, formatDate } from "../lib";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import "../local-businesses.css";

type View = "no_site" | "all";
type Has = "any" | "phone" | "social" | "strong";
type Sort = "newest" | "best";
type Counts = { all: number; phone: number; social: number; strong: number };
type Row = LocalBusiness & { prospect?: Prospect };
const scoreOf = (b: Row) => b.prospect ?? prospectScore(b);
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
/** One link per network: a listing and the web check can both find a page. */
const networks = (b: LocalBusiness) => [
  ...new Map(b.social_links.map((s) => [s.network, s])).values(),
];
const hasSocial = (b: LocalBusiness) => b.social_links.length > 0;

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
  finderOpen,
  onFinder,
}: {
  demo: boolean;
  notify: (message: string) => void;
  finderOpen: boolean;
  onFinder: (open: boolean) => void;
}) {
  // A notification links here with ?search=<id>&has=strong.
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>("no_site"),
    [query, setQuery] = useState(""),
    [q, setQ] = useState(""),
    [stage, setStage] = useState<LocalStage | "any">("any"),
    [has, setHas] = useState<Has>(() => {
      const h = params.get("has");
      return h === "phone" || h === "social" || h === "strong" ? h : "any";
    }),
    [fromSearch, setFromSearch] = useState(params.get("search") ?? ""),
    [sort, setSort] = useState<Sort>("best"),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [counts, setCounts] = useState<Counts>({
      all: 0,
      phone: 0,
      social: 0,
      strong: 0,
    }),
    [loading, setLoading] = useState(!demo),
    [loaded, setLoaded] = useState(demo),
    [error, setError] = useState(""),
    [status, setStatus] = useState<Status>({
      geoapify_configured: true,
      website_check: "tavily",
    }),
    [open, setOpen] = useState<Row | null>(null),
    [saving, setSaving] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [recent, setRecent] = useState<LocalSearch[]>(
      demo ? demoLocalSearches : [],
    );
  const filtered = view !== "no_site" || !!q || stage !== "any" || !!fromSearch;
  useEffect(() => {
    // Follow a notification clicked while already on this page.
    const s = params.get("search");
    if (s && s !== fromSearch) {
      setFromSearch(s);
      const h = params.get("has");
      setHas(h === "strong" || h === "phone" || h === "social" ? h : "any");
      setPage(0);
    }
  }, [params]);
  const clearSearch = () => {
    setFromSearch("");
    setPage(0);
    setParams(
      (p) => {
        p.delete("search");
        p.delete("has");
        return p;
      },
      { replace: true },
    );
  };
  const searchName = (() => {
    const r = recent.find((x) => x.id === fromSearch);
    if (!r) return "one search";
    const names = r.trades.map(tradeLabel);
    return `${names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ")} in ${r.cities.length ? r.cities.join(", ") : r.countries.map((c) => countryShort[c]).join(", ")}`;
  })();

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(query.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

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
      const needle = q.toLowerCase();
      const base = demoLocalBusinesses.filter(
        (b) =>
          (view === "all" || b.website_check !== "site_found") &&
          (stage === "any" || b.stage === stage) &&
          (!needle ||
            [b.name, b.city, b.trade].some((v) =>
              v.toLowerCase().includes(needle),
            )),
      );
      const strong = (b: LocalBusiness) =>
        prospectScore(b).tier === "strong" && b.stage !== "lost";
      const list = base.filter((b) =>
        has === "phone"
          ? !!b.phone
          : has === "social"
            ? hasSocial(b)
            : has === "strong"
              ? strong(b)
              : true,
      );
      if (sort === "best")
        list.sort((a, b) => prospectScore(b).score - prospectScore(a).score);
      setRows(list.slice(page * pageSize, page * pageSize + pageSize));
      setTotal(list.length);
      setCounts({
        all: base.length,
        phone: base.filter((b) => b.phone).length,
        social: base.filter(hasSocial).length,
        strong: base.filter(strong).length,
      });
      return;
    }
    let current = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      view,
      q,
      stage,
      has,
      sort,
      ...(fromSearch ? { search: fromSearch } : {}),
      page: String(page),
      size: String(pageSize),
    });
    api<{ rows: Row[]; total: number; counts?: Counts } & Status>(
      `/local-businesses?${params}`,
    )
      .then((r) => {
        if (!current) return;
        setRows(r.rows);
        setTotal(r.total);
        setCounts(r.counts ?? { all: r.total, phone: 0, social: 0, strong: 0 });
        setStatus({
          geoapify_configured: r.geoapify_configured,
          website_check: r.website_check,
        });
        setLoaded(true);
      })
      .catch((e) => current && setError((e as Error).message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [demo, view, q, stage, has, sort, fromSearch, page, revision]);

  // With nothing found yet, the finder is the whole page.
  const empty = loaded && !error && counts.all === 0 && !filtered;
  useEffect(() => {
    if (empty) onFinder(true);
  }, [empty, onFinder]);

  async function moveStage(b: Row, next: LocalStage) {
    const before = rows;
    setRows((r) => r.map((x) => (x.id === b.id ? { ...x, stage: next } : x)));
    if (demo) return;
    setSaving(b.id);
    try {
      const saved = await api<LocalBusiness>(
        `/local-businesses/${b.id}`,
        { stage: next },
        "PATCH",
      );
      setRows((r) =>
        r.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)),
      );
    } catch (e) {
      setRows(before);
      notify(`Couldn't save the stage: ${(e as Error).message}`);
    } finally {
      setSaving(null);
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? page * pageSize + 1 : 0;
  const last = Math.min(total, (page + 1) * pageSize);
  const pick = (next: Has) => {
    setHas((h) => (h === next ? "any" : next));
    setPage(0);
  };
  return (
    <>
      {finderOpen && (
        <LocalSearchForm
          demo={demo}
          status={status}
          recent={recent}
          onClose={empty ? undefined : () => onFinder(false)}
          onQueued={() => {
            notify("Search queued. Track it in Automation jobs.");
            setTimeout(() => setRevision((n) => n + 1), 4000);
          }}
        />
      )}
      {!empty && (
        <section
          className="panel local-sheet"
          aria-labelledby="local-sheet-title"
        >
          <header className="local-sheet-head">
            <h2 id="local-sheet-title">
              <span className="local-num">{counts.all}</span>{" "}
              {view === "no_site"
                ? counts.all === 1
                  ? "business with no website found"
                  : "businesses with no website found"
                : counts.all === 1
                  ? "business checked"
                  : "businesses checked"}
            </h2>
            <div className="local-has" aria-label="Show only">
              <button
                type="button"
                className="local-has-strong"
                aria-pressed={has === "strong"}
                onClick={() => pick("strong")}
              >
                <Target size={14} />
                <span className="local-num">{counts.strong}</span> strong
                prospects
              </button>
              <button
                type="button"
                aria-pressed={has === "phone"}
                onClick={() => pick("phone")}
              >
                <Phone size={14} />
                <span className="local-num">{counts.phone}</span> with a phone
              </button>
              <button
                type="button"
                aria-pressed={has === "social"}
                onClick={() => pick("social")}
              >
                <AtSign size={14} />
                <span className="local-num">{counts.social}</span> with social
                pages
              </button>
            </div>
          </header>
          {fromSearch && (
            <div className="local-from" role="status">
              <span>
                Showing leads from <strong>{searchName}</strong>
              </span>
              <button
                type="button"
                className="text-button"
                onClick={clearSearch}
              >
                Show all
              </button>
            </div>
          )}
          <div className="local-toolbar">
            <div
              className="table-tabs"
              role="tablist"
              aria-label="Which businesses"
            >
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
            <label className="search-input local-find">
              <Search size={16} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, trade or city"
                aria-label="Search businesses"
              />
            </label>
            <button
              type="button"
              className="local-sort"
              aria-pressed={sort === "best"}
              onClick={() => {
                setSort((v) => (v === "best" ? "newest" : "best"));
                setPage(0);
              }}
            >
              <ArrowDownWideNarrow size={15} />
              Best prospects first
            </button>
            <label className="local-stage-filter">
              <span>Stage</span>
              <select
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value as LocalStage | "any");
                  setPage(0);
                }}
              >
                <option value="any">Any</option>
                {localStages.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel[s]}
                  </option>
                ))}
              </select>
            </label>
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
            <div className="empty-state local-none">
              <p>
                {has === "phone"
                  ? "None of these have a phone number listed."
                  : has === "social"
                    ? "None of these have a social page."
                    : has === "strong"
                      ? "No strong prospects here yet. Strong ones have no site, a phone or social page, and a trade where a site wins work."
                      : "No business matches. Try another name, trade or city, or set Stage to Any."}
              </p>
            </div>
          ) : (
            <ul className="local-list" aria-busy={loading}>
              {loading && rows.length === 0
                ? Array.from({ length: 5 }, (_, i) => (
                    <li key={i} className="local-row local-row-skeleton">
                      <span className="pipeline-skeleton-line" />
                    </li>
                  ))
                : rows.map((b) => (
                    <li key={b.id} className="local-row" data-stage={b.stage}>
                      <span
                        className="local-score"
                        data-tier={scoreOf(b).tier}
                        title={`${tierLabel[scoreOf(b).tier]}: ${scoreOf(b).score} out of 100`}
                      >
                        <span className="local-num">{scoreOf(b).score}</span>
                        <span className="sr-only">
                          {tierLabel[scoreOf(b).tier]}, {scoreOf(b).score} out
                          of 100
                        </span>
                      </span>
                      <button
                        type="button"
                        className="local-who"
                        onClick={() => setOpen(b)}
                      >
                        <strong>{b.name}</strong>
                        <small>
                          {b.trade} · {b.city}
                          {b.country ? `, ${countryShort[b.country]}` : ""}
                        </small>
                      </button>
                      <div className="local-dial">
                        {b.phone ? (
                          <a href={tel(b.phone)} aria-label={`Call ${b.name}`}>
                            <Phone size={14} />
                            <span>{b.phone}</span>
                          </a>
                        ) : (
                          <span className="unknown">
                            <span aria-hidden>—</span>
                            <span className="sr-only">No phone listed</span>
                          </span>
                        )}
                      </div>
                      <div className="local-online">
                        {b.website_check === "site_found" ? (
                          <span className="local-has-site">
                            Has a site
                            {b.found_site && (
                              <>
                                :{" "}
                                <a
                                  href={`https://${b.found_site}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {b.found_site}
                                </a>
                              </>
                            )}
                          </span>
                        ) : networks(b).length ? (
                          <span className="local-social">
                            <span>Only on</span>
                            {networks(b).map((s) => (
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
                          <span className="unknown">
                            {b.website_check === "not_checked"
                              ? "Not checked yet"
                              : "Nothing found online"}
                          </span>
                        )}
                      </div>
                      <label className="local-stage">
                        <span className="sr-only">Stage for {b.name}</span>
                        <i aria-hidden />
                        <select
                          value={b.stage}
                          disabled={saving === b.id}
                          onChange={(e) =>
                            void moveStage(b, e.target.value as LocalStage)
                          }
                        >
                          {localStages.map((s) => (
                            <option key={s} value={s}>
                              {stageLabel[s]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </li>
                  ))}
            </ul>
          )}
          <footer className="local-sheet-foot">
            <Attribution />
            <div className="pagination">
              <span>{total ? `${first}–${last} of ${total}` : "None"}</span>
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
          </footer>
        </section>
      )}
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
const groupLabel: Record<string, string> = {
  "Construction and home services": "Building and home",
  "Beauty and fitness": "Beauty and fitness",
  "Health and pets": "Health and pets",
  "Other local services": "Other",
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
  onClose,
}: {
  demo: boolean;
  status: Status;
  recent: LocalSearch[];
  onQueued: () => void;
  onClose?: () => void;
}) {
  const [trades, setTrades] = useState<string[]>(["construction"]),
    [query, setQuery] = useState(""),
    [countries, setCountries] = useState<Country[]>(["US"]),
    [mode, setMode] = useState<"biggest" | "cities">("cities"),
    [cities, setCities] = useState(""),
    [perPlace, setPerPlace] = useState(20),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState(""),
    [group, setGroup] = useState(localTrades[0].group);
  const list =
    mode === "cities"
      ? cities
          .split(/[\n;]+/)
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
  const areas =
    mode === "cities"
      ? list.length
      : countries.reduce((n, c) => n + biggestCities[c].length, 0);
  const cost = estimate(trades, areas, areas, perPlace);
  const full = trades.length >= maxSearchTrades;
  const groups = [...new Set(localTrades.map((t) => t.group))];
  const q = query.trim().toLowerCase();
  const matches = q ? localTrades.filter((t) => tradeMatchesQuery(t, q)) : [];
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
    (mode === "biggest" || (list.length > 0 && list.length <= 10));
  const chip = (t: (typeof localTrades)[number]) => {
    const on = trades.includes(t.id);
    return (
      <button
        type="button"
        key={t.id}
        className="local-trade"
        aria-pressed={on}
        disabled={!on && full}
        onClick={() => toggleTrade(t.id)}
      >
        {t.label}
      </button>
    );
  };
  const inGroup = localTrades.filter((t) => t.group === group);
  const places =
    mode === "cities" ? list : countries.flatMap((c) => biggestCities[c]);
  const headline = demo
    ? "Sample data"
    : !status.geoapify_configured
      ? "Geoapify key needed"
      : trades.length === 0
        ? "Pick at least one trade"
        : countries.length === 0
          ? "Pick at least one country"
          : mode === "cities" && list.length === 0
            ? "Add at least one city"
            : list.length > 10
              ? "Up to 10 cities per search"
              : null;
  const note = demo
    ? "Connect your workspace to run a real search."
    : !status.geoapify_configured
      ? "Add GEOAPIFY_API_KEY to the server's .env, then restart the API and worker."
      : null;
  return (
    <form
      id="local-finder"
      className="panel local-finder"
      aria-labelledby="local-finder-title"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void run(
          { trades, countries, cities: list, per_city: perPlace },
          "new",
        );
      }}
    >
      <div className="local-search-head">
        <div>
          <h2 id="local-finder-title">Find businesses without a website</h2>
          <p>
            Scout lists the trades you pick from OpenStreetMap, keeps the ones
            with no website on their listing, then runs one web search for each
            to make sure.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            className="icon-button"
            aria-label="Close the finder"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="local-finder-grid">
        <div className="local-finder-choices">
          <section className="local-step" aria-labelledby="local-step-trades">
            <h3 id="local-step-trades">
              <span>1</span>Trades
              <small className="local-num">
                {trades.length}/{maxSearchTrades}
              </small>
            </h3>
            <div className="local-presets" aria-label="Quick picks">
              {[
                { label: "Most likely to buy", trades: bestBetTrades },
                ...localTradePresets,
              ].map((p, i) => (
                <button
                  type="button"
                  key={p.label}
                  className={`local-chip${i === 0 ? " local-chip-best" : ""}`}
                  aria-pressed={p.trades.every((id) => trades.includes(id))}
                  onClick={() => togglePreset(p.trades)}
                >
                  {i === 0 && <Target size={13} />}
                  {p.label}
                </button>
              ))}
            </div>
            <label className="search-input local-trade-search">
              <Search size={16} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${localTrades.length} trades, e.g. roofer, vet, bakery`}
                aria-label="Search trades"
              />
            </label>
            {q ? (
              <div className="local-trade-grid" aria-label="Matching trades">
                {matches.length ? (
                  matches.map(chip)
                ) : (
                  <span className="unknown">No trade matches “{query}”.</span>
                )}
              </div>
            ) : (
              <div className="local-trade-browser">
                <div
                  className="local-group-tabs"
                  role="tablist"
                  aria-label="Trade groups"
                >
                  {groups.map((g) => {
                    const picked = localTrades.filter(
                      (t) => t.group === g && trades.includes(t.id),
                    ).length;
                    return (
                      <button
                        type="button"
                        role="tab"
                        key={g}
                        aria-selected={group === g}
                        onClick={() => setGroup(g)}
                      >
                        {groupLabel[g] ?? g}
                        {picked > 0 && (
                          <span className="local-num">{picked}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="local-trade-grid" role="tabpanel">
                  {inGroup.map(chip)}
                </div>
              </div>
            )}
            {full && (
              <small className="local-hint">
                That's the most for one search. Run it, then pick the next set.
              </small>
            )}
          </section>

          <section className="local-step" aria-labelledby="local-step-where">
            <h3 id="local-step-where">
              <span>2</span>Where
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
            <div
              className="local-seg"
              role="radiogroup"
              aria-label="Which cities"
            >
              {(
                [
                  ["cities", "Cities I choose"],
                  ["biggest", "Biggest cities"],
                ] as const
              ).map(([id, label]) => (
                <button
                  type="button"
                  role="radio"
                  key={id}
                  aria-checked={mode === id}
                  onClick={() => setMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "cities" ? (
              <label className="field-label local-cities">
                <span className="sr-only">Cities, one per line, up to 10</span>
                <textarea
                  rows={3}
                  value={cities}
                  placeholder={(countries.length ? countries : localCountries)
                    .map((c) => cityExamples[c])
                    .join("\n")}
                  onChange={(e) => setCities(e.target.value)}
                />
                <small>
                  One city per line, up to 10. Add the state or province to pick
                  the right one.
                </small>
              </label>
            ) : (
              <small className="local-hint">
                The 5 biggest cities in each country you pick.
              </small>
            )}
          </section>

          <section className="local-step" aria-labelledby="local-step-many">
            <h3 id="local-step-many">
              <span>3</span>How many
            </h3>
            <div className="local-many">
              <div
                className="local-seg"
                role="radiogroup"
                aria-label="Businesses per trade in each city"
              >
                {[10, 20, 50].map((n) => (
                  <button
                    type="button"
                    role="radio"
                    key={n}
                    aria-checked={perPlace === n}
                    onClick={() => setPerPlace(n)}
                  >
                    <span className="local-num">{n}</span>
                  </button>
                ))}
              </div>
              <small className="local-hint">per trade, in each city</small>
            </div>
          </section>
        </div>

        <aside className="local-ticket" aria-label="This search">
          <h3>This search</h3>
          <dl>
            <div>
              <dt>Trades</dt>
              <dd>
                {trades.length ? (
                  <span className="local-ticket-trades">
                    {trades.map((id) => (
                      <span key={id} className="local-pick">
                        {tradeLabel(id)}
                        <button
                          type="button"
                          aria-label={`Remove ${tradeLabel(id)}`}
                          onClick={() => toggleTrade(id)}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="unknown">None yet</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Places</dt>
              <dd>
                {places.length ? (
                  places.slice(0, 6).join(", ") +
                  (places.length > 6 ? ` and ${places.length - 6} more` : "")
                ) : (
                  <span className="unknown">None yet</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Finds up to</dt>
              <dd>
                <span className="local-num">
                  {cost.businesses.toLocaleString()}
                </span>{" "}
                businesses
              </dd>
            </div>
            <div>
              <dt>Uses</dt>
              <dd>
                About <span className="local-num">{cost.requests}</span> map
                requests (free)
                {status.website_check ? (
                  <>
                    , and up to{" "}
                    <span className="local-num">
                      {cost.businesses.toLocaleString()}
                    </span>{" "}
                    Tavily credits: one for each business with no website on its
                    listing
                  </>
                ) : (
                  <>. No web search is set up, so there's no website check</>
                )}
                .
              </dd>
            </div>
          </dl>
          {(headline || note) && (
            <p className="local-ticket-note" role="status">
              {headline && <strong>{headline}.</strong>} {note}
            </p>
          )}
          {cost.byName && ready && (
            <p className="local-ticket-note">
              Some trades are matched by business name, so a few may be missed.
            </p>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={blocked || !ready || !!busy}>
            {busy === "new" ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Search size={16} />
            )}
            Find businesses
          </Button>

          {recent.length > 0 && (
            <section
              className="local-recent"
              aria-labelledby="local-recent-title"
            >
              <h4 id="local-recent-title">Recent searches</h4>
              <ul>
                {recent.map((r) => (
                  <li key={r.id}>
                    <div>
                      <strong>
                        {r.trades.slice(0, 2).map(tradeLabel).join(", ")}
                        {r.trades.length > 2 && ` +${r.trades.length - 2}`}
                      </strong>
                      <small>
                        {r.cities.length
                          ? r.cities.join(", ")
                          : `Biggest cities: ${r.countries.map((c) => countryShort[c]).join(", ")}`}{" "}
                        · {plural(r.saved ?? 0, "saved", "saved")}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Run again: ${r.trades.map(tradeLabel).join(", ")}`}
                      title="Run again"
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
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </form>
  );
}

const dayNames: Record<string, string> = {
  mo: "Mon",
  tu: "Tue",
  we: "Wed",
  th: "Thu",
  fr: "Fri",
  sa: "Sat",
  su: "Sun",
  ph: "Holidays",
};
/** "Mo-Th 08:00-16:30; Fr 08:00-15:30" as one readable line per rule. */
export function hoursLines(hours: string) {
  return hours
    .split(/\s*;\s*/)
    .filter(Boolean)
    .map((rule) =>
      rule
        .replace(
          /\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g,
          (d) => dayNames[d.toLowerCase()],
        )
        .replace(/(\d)-(\d)/g, "$1–$2")
        .replace(/([a-z])-([A-Z])/g, "$1–$2")
        .replace(/\boff\b/i, "closed"),
    );
}

function LocalBusinessDetail({
  lead,
  demo,
  onClose,
  onSaved,
}: {
  lead: Row;
  demo: boolean;
  onClose: () => void;
  onSaved: (b: LocalBusiness) => void;
}) {
  const [stage, setStage] = useState(lead.stage),
    [notes, setNotes] = useState(lead.notes),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const changed = stage !== lead.stage || notes !== lead.notes;
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
  const prospect = scoreOf(lead);
  const where = `${lead.city}${lead.country ? `, ${countryShort[lead.country]}` : ""}`;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={lead.name}
      description={`${lead.trade} · ${where} · found ${formatDate(lead.found_at, true)}`}
      className="local-drawer"
    >
      <div className="local-detail">
        <section className="local-verdict" data-tier={prospect.tier}>
          <span className="local-verdict-score local-num">
            {prospect.score}
          </span>
          <div>
            <strong>{tierLabel[prospect.tier]}</strong>
            <span
              className="local-meter"
              role="meter"
              aria-label="Prospect score"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={prospect.score}
            >
              <i style={{ width: `${prospect.score}%` }} />
            </span>
          </div>
        </section>

        <section className="local-actions" aria-label="Get in touch">
          {lead.phone ? (
            <a className="button local-call" href={tel(lead.phone)}>
              <Phone size={16} />
              <span>
                Call <span className="local-num">{lead.phone}</span>
              </span>
            </a>
          ) : (
            <p className="local-no-phone">
              No phone on the listing.{" "}
              {networks(lead).length
                ? "Message them on a social page instead."
                : "Look them up on the map for another way in."}
            </p>
          )}
          <div className="local-links">
            {networks(lead).map((s) => (
              <a
                key={s.url}
                className="local-link"
                href={s.url}
                target="_blank"
                rel="noreferrer"
              >
                <AtSign size={14} />
                {socialLabel[s.network]}
              </a>
            ))}
            {lead.email && (
              <a className="local-link" href={`mailto:${lead.email}`}>
                <Mail size={14} />
                Email
              </a>
            )}
            {map && (
              <a
                className="local-link"
                href={map}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin size={14} />
                Map
              </a>
            )}
          </div>
        </section>

        <section aria-labelledby="local-why">
          <h3 id="local-why">Why it scores {prospect.score}</h3>
          <ul className="local-reasons">
            {prospect.reasons.map((r) => (
              <li key={r.text}>
                <span>{r.text}</span>
                <span className="local-num">
                  {r.points ? `+${r.points}` : "–"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="local-facts">
          <h3 id="local-facts">Details</h3>
          <dl className="local-facts">
            <div>
              <dt>Website</dt>
              <dd>
                <span
                  className={`local-check local-check-${lead.website_check}`}
                >
                  {websiteCheckLabel[lead.website_check]}
                </span>
                <small>
                  {lead.website_check === "not_checked" ? (
                    "The listing has none. No web search was set up when it was found, so Scout hasn't looked further."
                  ) : lead.website_check === "site_found" ? (
                    <>
                      Looks like theirs:{" "}
                      <a
                        href={`https://${lead.found_site}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {lead.found_site}
                      </a>
                      {lead.check_query === "Domain guess" &&
                        " (found by trying their name as a domain)"}
                      .
                    </>
                  ) : (
                    `The listing has none, and a web search for ${lead.check_query ?? "the business"} found none either. That isn't proof they have none.`
                  )}
                </small>
              </dd>
            </div>
            {lead.address && (
              <div>
                <dt>Address</dt>
                <dd>{lead.address}</dd>
              </div>
            )}
            {lead.opening_hours && (
              <div>
                <dt>Hours</dt>
                <dd>
                  {hoursLines(lead.opening_hours).map((line) => (
                    <span key={line} className="local-hours">
                      {line}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="local-notes" aria-labelledby="local-notes">
          <h3 id="local-notes">Your notes</h3>
          <div
            className="local-seg local-stage-seg"
            role="radiogroup"
            aria-label="Stage"
          >
            {localStages.map((s) => (
              <button
                type="button"
                role="radio"
                key={s}
                data-stage={s}
                aria-checked={stage === s}
                onClick={() => setStage(s)}
              >
                {stageLabel[s]}
              </button>
            ))}
          </div>
          <label className="field-label">
            <span className="sr-only">Notes</span>
            <textarea
              rows={4}
              maxLength={4000}
              value={notes}
              placeholder="Who you spoke to, what they need, when to call back"
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <div className="local-notes-foot">
            <Attribution />
            <Button onClick={() => void save()} disabled={busy || !changed}>
              {busy && <LoaderCircle className="spin" size={16} />}
              {changed ? "Save" : "Saved"}
            </Button>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
