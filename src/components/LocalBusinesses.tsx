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
  Search,
} from "lucide-react";
import {
  localCountries,
  localStages,
  localTrades,
  maxSearchTrades,
  socialLabel,
  websiteCheckLabel,
  type LocalBusiness,
  type LocalStage,
} from "../../shared/local-business";
import { countryNames, type Country } from "../../shared/types";
import { demoLocalBusinesses } from "../demo";
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
    [revision, setRevision] = useState(0);

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

function LocalSearchForm({
  demo,
  status,
  onQueued,
}: {
  demo: boolean;
  status: Status;
  onQueued: () => void;
}) {
  const [trades, setTrades] = useState<string[]>(["construction"]),
    [countries, setCountries] = useState<Country[]>(["US"]),
    [cities, setCities] = useState(""),
    [perCity, setPerCity] = useState(20),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const list = cities
    .split(/[\n;]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const groups = [...new Set(localTrades.map((t) => t.group))];
  const chosen = localTrades.filter((t) => trades.includes(t.id));
  const areas = list.length || countries.length;
  // Each area costs at most two map requests (one per kind of trade), plus a
  // geocode per city; web checks come on top, one per business found.
  const mapRequests =
    areas *
      (Number(chosen.some((t) => t.categories.length)) +
        Number(chosen.some((t) => t.broad))) +
    list.length;
  const toggle = <T,>(value: T, on: T[], set: (v: T[]) => void) =>
    set(on.includes(value) ? on.filter((v) => v !== value) : [...on, value]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/local-searches", {
        trades,
        countries,
        cities: list,
        per_city: perCity,
      });
      onQueued();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const tooMany = trades.length > maxSearchTrades || list.length > 10;
  const note = demo
    ? "Sample data. Connect your workspace to run a real search."
    : !status.geoapify_configured
      ? "Add GEOAPIFY_API_KEY to the server's .env, then restart the API and worker."
      : tooMany
        ? `Choose up to ${maxSearchTrades} trades and 10 cities per search.`
        : [
            `${chosen.length} ${chosen.length === 1 ? "trade" : "trades"} in ${list.length ? `${list.length} ${list.length === 1 ? "city" : "cities"}` : `all of ${countries.length} ${countries.length === 1 ? "country" : "countries"}`} · about ${mapRequests} map requests, plus one web check per business.`,
            chosen.some((t) => t.broad)
              ? "Some trades are matched by business name, so a business with a vague name may be missed."
              : "",
            status.website_check
              ? ""
              : "No web search is set up, so businesses are saved without the website check.",
          ]
            .filter(Boolean)
            .join(" ");
  return (
    <form className="panel local-search" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <h2>Find businesses without a website</h2>
          <p>
            Pick as many trades and countries as you like. Searches
            OpenStreetMap through Geoapify's free plan, then runs one web search
            for each business with no website listed.
          </p>
        </div>
      </div>
      <fieldset className="local-trades">
        <legend>
          Trades{" "}
          <span className="count-badge">
            {trades.length}/{maxSearchTrades}
          </span>
          {trades.length > 0 && (
            <button
              type="button"
              className="text-button"
              onClick={() => setTrades([])}
            >
              Clear
            </button>
          )}
        </legend>
        <div className="local-trade-groups">
          {groups.map((g) => (
            <div key={g} className="local-trade-group">
              <strong>{g}</strong>
              {localTrades
                .filter((t) => t.group === g)
                .map((t) => (
                  <label key={t.id} className="local-check-option">
                    <input
                      type="checkbox"
                      checked={trades.includes(t.id)}
                      disabled={
                        !trades.includes(t.id) &&
                        trades.length >= maxSearchTrades
                      }
                      onChange={() => toggle(t.id, trades, setTrades)}
                    />
                    {t.label}
                  </label>
                ))}
            </div>
          ))}
        </div>
      </fieldset>
      <div className="local-search-fields">
        <fieldset className="local-countries">
          <legend>Countries</legend>
          {localCountries.map((c) => (
            <label key={c} className="local-check-option">
              <input
                type="checkbox"
                checked={countries.includes(c)}
                onChange={() => toggle(c, countries, setCountries)}
              />
              {countryNames[c]}
            </label>
          ))}
        </fieldset>
        <label className="field-label local-cities">
          Cities, one per line (optional)
          <textarea
            rows={3}
            value={cities}
            placeholder={"Austin, TX\nToronto, ON\nManchester\nBrisbane, QLD"}
            onChange={(e) => setCities(e.target.value)}
          />
          <small>Leave empty to search each country as a whole.</small>
        </label>
        <label className="field-label">
          Businesses per trade, per place
          <select
            value={perCity}
            onChange={(e) => setPerCity(Number(e.target.value))}
          >
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>
                Up to {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <div className="local-search-actions">
        <small>{note}</small>
        <Button
          type="submit"
          disabled={
            demo ||
            !status.geoapify_configured ||
            busy ||
            tooMany ||
            trades.length === 0 ||
            countries.length === 0
          }
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Search size={16} />
          )}
          Find businesses
        </Button>
      </div>
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
