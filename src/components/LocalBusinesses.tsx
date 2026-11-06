import { useEffect, useState, type FormEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Globe,
  HardHat,
  LoaderCircle,
  MapPin,
  Phone,
  Search,
  Star,
} from "lucide-react";
import {
  localStages,
  localTradeSuggestions,
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
const pageSize = 10;
const stageLabel: Record<LocalStage, string> = {
  new: "New",
  contacted: "Contacted",
  won: "Won",
  lost: "Lost",
};
const missing = {
  not_configured: "Add a Google Places key to see listing details",
  budget: "Today's listing lookups are used up",
  unavailable: "Listing unavailable",
};

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
    [configured, setConfigured] = useState(true),
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
    api<{ rows: LocalBusiness[]; total: number; places_configured: boolean }>(
      `/local-businesses?view=${view}&page=${page}&size=${pageSize}`,
    )
      .then((r) => {
        if (!current) return;
        setRows(r.rows);
        setTotal(r.total);
        setConfigured(r.places_configured);
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
        configured={configured}
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
              Businesses whose Google listing links no website, checked against
              a web search.
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
              No local businesses yet. Search a trade and a few cities to find
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
                        <td colSpan={6}>
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
                            <strong>
                              {b.listing?.name ??
                                (b.listing_error
                                  ? missing[b.listing_error]
                                  : "Listing unavailable")}
                            </strong>
                            <small>{b.listing?.type ?? b.trade}</small>
                          </button>
                        </td>
                        <td>{b.city}</td>
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
          <span className="local-attribution">
            Listing details from Google Maps
          </span>
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
          listed={open}
          demo={demo}
          onClose={() => setOpen(null)}
          onSaved={(b) => {
            setRows((r) => r.map((x) => (x.id === b.id ? { ...x, ...b } : x)));
            notify("Saved");
          }}
        />
      )}
    </>
  );
}

function LocalSearchForm({
  demo,
  configured,
  onQueued,
}: {
  demo: boolean;
  configured: boolean;
  onQueued: () => void;
}) {
  const [trade, setTrade] = useState("Construction company"),
    [cities, setCities] = useState(""),
    [country, setCountry] = useState<Country>("US"),
    [perCity, setPerCity] = useState(20),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const list = cities
    .split(/[\n;]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/local-searches", {
        trade,
        cities: list,
        country,
        per_city: perCity,
      });
      onQueued();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const blocked = demo || !configured;
  return (
    <form className="panel local-search" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <h2>Find businesses without a website</h2>
          <p>
            One Google Maps search per city, then a web search for each listing
            that links no website. Each request counts toward today's budget.
          </p>
        </div>
      </div>
      <div className="local-search-fields">
        <label className="field-label">
          Trade
          <input
            list="local-trades"
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            required
            minLength={2}
            maxLength={80}
          />
          <datalist id="local-trades">
            {localTradeSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className="field-label local-cities">
          Cities, one per line
          <textarea
            rows={2}
            value={cities}
            placeholder={"Austin, TX\nRound Rock, TX"}
            onChange={(e) => setCities(e.target.value)}
            required
          />
        </label>
        <label className="field-label">
          Country
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value as Country)}
          >
            {(Object.keys(countryNames) as Country[]).map((c) => (
              <option key={c} value={c}>
                {countryNames[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Listings per city
          <select
            value={perCity}
            onChange={(e) => setPerCity(Number(e.target.value))}
          >
            {[10, 20].map((n) => (
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
        <small>
          {demo
            ? "Sample data. Connect your workspace to run a real search."
            : !configured
              ? "Add GOOGLE_PLACES_API_KEY to the server's .env, then restart the API and worker."
              : `${list.length || "No"} ${list.length === 1 ? "city" : "cities"} · up to ${list.length * perCity} listings`}
        </small>
        <Button
          type="submit"
          disabled={blocked || busy || list.length === 0 || list.length > 10}
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
  listed,
  demo,
  onClose,
  onSaved,
}: {
  listed: LocalBusiness;
  demo: boolean;
  onClose: () => void;
  onSaved: (b: LocalBusiness) => void;
}) {
  const [lead, setLead] = useState(listed),
    [loading, setLoading] = useState(!demo),
    [stage, setStage] = useState(listed.stage),
    [notes, setNotes] = useState(listed.notes),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (demo) return;
    let current = true;
    api<LocalBusiness>(`/local-businesses/${listed.id}`)
      .then((b) => current && setLead(b))
      .catch((e) => current && setError((e as Error).message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [demo, listed.id]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = demo
        ? { ...lead, stage, notes }
        : await api<LocalBusiness>(
            `/local-businesses/${lead.id}`,
            { stage, notes },
            "PATCH",
          );
      onSaved({ ...lead, ...saved, listing: lead.listing });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const l = lead.listing;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={l?.name ?? listed.listing?.name ?? "Local business"}
      description={`${lead.trade} · ${lead.city}`}
    >
      <div className="local-detail">
        <section>
          <h3>Listing</h3>
          {loading ? (
            <p className="local-note">
              <LoaderCircle className="spin" size={14} /> Loading the Google
              listing…
            </p>
          ) : l ? (
            <ul className="local-facts">
              {l.phone && (
                <li>
                  <Phone size={14} />
                  <a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}>
                    {l.phone}
                  </a>
                </li>
              )}
              {l.address && (
                <li>
                  <MapPin size={14} />
                  {l.address}
                </li>
              )}
              {l.rating != null && (
                <li>
                  <Star size={14} />
                  {l.rating.toFixed(1)} from {l.reviews ?? 0} reviews
                </li>
              )}
              {!!l.hours?.length && (
                <li>
                  <Clock3 size={14} />
                  <span>{l.hours.join(" · ")}</span>
                </li>
              )}
              {l.website && (
                <li>
                  <Globe size={14} />
                  The listing now links a website: {l.website}
                </li>
              )}
              {l.maps_url && (
                <li>
                  <ExternalLink size={14} />
                  <a href={l.maps_url} target="_blank" rel="noreferrer">
                    Open in Google Maps
                  </a>
                </li>
              )}
            </ul>
          ) : (
            <p className="local-note">
              {lead.listing_error
                ? missing[lead.listing_error]
                : "Listing unavailable"}
            </p>
          )}
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
              ? "The Google listing links no website. No web search was set up when it was found, so Scout hasn't looked further."
              : lead.website_check === "site_found"
                ? `A site that looks like theirs turned up: ${lead.found_site}.`
                : `The Google listing links no website, and a web search for ${lead.check_query ?? "the business"} found none. That isn't proof they have none.`}
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
        <small className="local-attribution">
          Listing details from Google Maps, fetched now and not stored.
        </small>
      </div>
    </Dialog>
  );
}
