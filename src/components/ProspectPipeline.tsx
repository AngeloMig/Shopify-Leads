import { useEffect, useMemo, useRef, useState } from "react";
import {
  contactLabel,
  followUpLabel,
  isDue,
  localDay,
} from "../../shared/contact-log";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Search,
  ArrowUpRight,
  LoaderCircle,
  Copy,
  Check,
  Upload,
  X,
  Gauge,
} from "lucide-react";
import type { Lead } from "../../shared/types";
import { countryNames } from "../../shared/types";
import {
  leadIntelligence,
  contactCategory,
} from "../../shared/lead-intelligence";
import { leadScoreFor } from "../../shared/lead-score";
import { csvCell } from "../../shared/scoring";
import { api, downloadBlob, formatDate } from "../lib";
import { Button } from "./ui/button";
import { DomainImport } from "./DomainImport";
import { AuditRequest } from "./AuditRequest";
type Filters = {
  q: string;
  view: string;
  country: string;
  stage: string;
  sort: string;
};
const defaults: Filters = {
  q: "",
  view: "all",
  country: "all",
  stage: "all",
  sort: "opportunity",
};
const views = [
  ["all", "All leads"],
  ["new", "New"],
  ["strong", "Strong opportunities"],
  ["missing_contact", "Missing email"],
  ["review", "Needs review"],
  ["due", "Due today"],
  ["won", "Won"],
  ["lost", "Lost"],
];
function readStoredViews(key: string): {
  filters: Filters;
  saved: { name: string; filters: Filters }[];
} {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    const f = value?.filters;
    return {
      filters:
        f && views.some((v) => v[0] === f.view)
          ? { ...defaults, ...f, q: typeof f.q === "string" ? f.q : "" }
          : defaults,
      saved: Array.isArray(value?.saved) ? value.saved.slice(0, 8) : [],
    };
  } catch {
    return { filters: defaults, saved: [] };
  }
}
export function ProspectPipeline({
  leads,
  onOpen,
  onReport,
  live,
  ready,
  workspaceId,
  queries,
  revision,
}: {
  leads: Lead[];
  onOpen: (l: Lead) => void;
  onReport: (l: Lead) => void;
  live: boolean;
  /** False until the workspace is known; this remounts if it turns out different. */
  ready: boolean;
  workspaceId: string;
  queries: { id?: string; name: string }[];
  /** Changes when the list may have new data; null until that's known. */
  revision: string | null;
}) {
  // App remounts this per workspace, so the key can't change during its lifetime.
  const storageKey = `scout-lead-views-v1:${live ? "live" : "demo"}:${workspaceId}`;
  const [stored] = useState(() => readStoredViews(storageKey));
  const [filters, setFilters] = useState<Filters>(stored.filters),
    [saved, setSaved] = useState(stored.saved),
    [viewName, setViewName] = useState(""),
    [page, setPage] = useState(0),
    [size, setSize] = useState(10),
    [rows, setRows] = useState<Lead[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(live),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState(stored.filters.q),
    [importOpen, setImportOpen] = useState(false),
    [auditOpen, setAuditOpen] = useState(false),
    [copiedEmail, setCopiedEmail] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    if (!copiedEmail) return;
    const timer = setTimeout(() => setCopiedEmail(""), 2500);
    return () => clearTimeout(timer);
  }, [copiedEmail]);
  async function copyEmail(email: string) {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
    } catch {
      setError(
        "Could not copy the email. You can select and copy it from the lead details.",
      );
    }
  }
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((f) => (f.q === search ? f : { ...f, q: search })),
      300,
    );
    return () => clearTimeout(timer);
  }, [search]);
  function change(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    setPage(0);
    setSelected([]);
    localStorage.setItem(storageKey, JSON.stringify({ filters: next, saved }));
  }
  function applySaved(index: number) {
    const next = saved[index]?.filters;
    if (!next) return;
    setSearch(next.q);
    change(next);
  }
  const query = new URLSearchParams({
    ...filters,
    today: localDay(),
    page: String(page),
    size: String(size),
  }).toString();
  const request = useRef<{ query: string; stale: boolean } | null>(null);
  function load(query: string) {
    const current = { query, stale: false };
    request.current = current;
    setLoading(true);
    setError("");
    void api<{ leads: Lead[]; total: number }>(`/leads?${query}`)
      .then((result) => {
        if (request.current !== current) return;
        if (page > 0 && page * size >= result.total) {
          setPage(Math.max(0, Math.ceil(result.total / size) - 1));
          return;
        }
        setRows(result.leads);
        setTotal(result.total);
      })
      .catch((e) => {
        if (request.current === current) setError(e.message);
      })
      .finally(() => {
        if (request.current !== current) return;
        request.current = null;
        if (current.stale) load(query);
        else setLoading(false);
      });
  }
  useEffect(() => {
    if (!live || !ready) return;
    // Deferred so a cleanup in the same tick (StrictMode's remount) sends nothing.
    const timer = setTimeout(() => load(query));
    return () => {
      clearTimeout(timer);
      request.current = null;
    };
  }, [live, ready, workspaceId, query, reload]);
  // New data refreshes the current view without dropping a response on its way.
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (seenRevision.current === revision) return;
    const first = seenRevision.current === null;
    seenRevision.current = revision;
    if (first || !live || !ready) return;
    if (request.current) request.current.stale = true;
    else load(query);
  }, [revision]);
  const local = useMemo(
    () =>
      leads
        .filter((l) => {
          const i = leadIntelligence(l);
          return (
            `${l.name} ${l.domain} ${l.industry} ${i.emails.map((e) => e.email).join(" ")}`
              .toLowerCase()
              .includes(filters.q.toLowerCase()) &&
            (filters.country === "all" || l.country === filters.country) &&
            (filters.stage === "all" || l.stage === filters.stage) &&
            (filters.view === "all" ||
              (filters.view === "new" && l.stage === "new") ||
              (filters.view === "strong" && i.rank === 2) ||
              (filters.view === "missing_contact" && !i.emails.length) ||
              (filters.view === "won" && l.outcome === "won") ||
              (filters.view === "lost" && l.outcome === "lost") ||
              (filters.view === "due" && isDue(l)) ||
              (filters.view === "review" &&
                l.permission === "unknown" &&
                !l.suppressed))
          );
        })
        .sort((a, b) =>
          filters.sort === "name"
            ? a.name.localeCompare(b.name)
            : filters.sort === "recent"
              ? String(b.audited_at).localeCompare(String(a.audited_at))
              : leadScoreFor(b).researchScore - leadScoreFor(a).researchScore ||
                (a.performance ?? 101) - (b.performance ?? 101),
        ),
    [leads, filters],
  );
  const filtered =
    filters.view !== "all" ||
    filters.country !== "all" ||
    filters.stage !== "all" ||
    !!search.trim();
  function clearFilters() {
    setSearch("");
    change({ view: "all", country: "all", stage: "all", q: "" });
  }
  const count = live ? total : local.length,
    visible = live ? rows : local.slice(page * size, (page + 1) * size),
    pages = Math.max(1, Math.ceil(count / size));
  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      let items =
        selected.length && live
          ? await Promise.all(selected.map((id) => api<Lead>(`/leads/${id}`)))
          : local.filter((l) => selected.includes(l.id));
      if (!selected.length) {
        items = live ? [] : local;
        if (live) {
          for (let offset = 0; ; offset++) {
            const result = await api<{ leads: Lead[]; total: number }>(
              `/leads?${new URLSearchParams({ ...filters, page: String(offset), size: "50" })}`,
            );
            items.push(...result.leads);
            if (items.length >= result.total || !result.leads.length) break;
            if (items.length >= 5000)
              throw new Error(
                "This export exceeds 5,000 leads. Narrow the filters and export again.",
              );
          }
        }
      }
      const data = [
        [
          "Store",
          "Domain",
          "Country",
          "Industry",
          "Industry confidence",
          "Main opportunity",
          "Strength",
          "Preferred available email",
          "Contact category",
          "Outreach review",
          "Next action",
          "Audit date",
        ],
        ...items.map((l) => {
          const i = leadIntelligence(l);
          return [
            l.name,
            l.domain,
            l.country,
            l.industry,
            l.industry_confidence,
            i.main,
            i.label,
            i.emails[0]?.email ?? "",
            i.emails[0] ? contactCategory(i.emails[0].email) : "",
            i.review,
            i.next,
            l.audited_at,
          ];
        }),
      ];
      downloadBlob(
        new Blob(
          [
            "\uFEFF" +
              data.map((row) => row.map(csvCell).join(",")).join("\r\n"),
          ],
          { type: "text/csv;charset=utf-8" },
        ),
        "scout-leads.csv",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <section
        className="panel prospect-pipeline"
        aria-label="Lead research pipeline"
      >
        <div className="pipeline-heading">
          <div className="pipeline-heading-label">
            <h2>Store directory</h2>
            <span className="pipeline-count" aria-live="polite">
              {loading && !visible.length
                ? "Loading…"
                : `${count} ${count === 1 ? "store" : "stores"}${loading ? " · updating" : ""}`}
            </span>
          </div>
          <div className="pipeline-utilities">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAuditOpen(true)}
            >
              <Gauge size={14} />
              Audit a website
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
            >
              <Upload size={14} />
              Import stores
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={exporting || loading}
              onClick={() => void exportCsv()}
            >
              {exporting ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Download size={14} />
              )}
              Export{" "}
              {selected.length ? `${selected.length} selected` : "filtered"}
            </Button>
          </div>
        </div>
        <div className="pipeline-views" aria-label="Lead views">
          {views.map(([id, label]) => (
            <button
              key={id}
              className={filters.view === id ? "active" : ""}
              aria-pressed={filters.view === id}
              onClick={() => change({ view: id })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="pipeline-filters">
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Search all leads"
              placeholder="Search every store, industry or email…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            {search && (
              <button
                className="pipeline-clear-search"
                aria-label="Clear lead search"
                onClick={() => {
                  setSearch("");
                  change({ q: "" });
                }}
              >
                <X size={14} />
              </button>
            )}
          </label>
          <select
            aria-label="Filter country"
            value={filters.country}
            onChange={(e) => change({ country: e.target.value })}
          >
            <option value="all">All countries</option>
            {Object.entries(countryNames).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter lead stage"
            value={filters.stage}
            onChange={(e) => change({ stage: e.target.value })}
          >
            <option value="all">All stages</option>
            {["new", "reviewing", "qualified", "hold", "suppressed"].map(
              (x) => (
                <option key={x} value={x}>
                  {x[0].toUpperCase() + x.slice(1)}
                </option>
              ),
            )}
          </select>
          {filtered && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              <X size={14} />
              Clear filters
            </Button>
          )}
        </div>
        <div className="pipeline-list-options">
          <details className="saved-views">
            <summary>
              Saved views {saved.length ? `· ${saved.length}` : ""}
            </summary>
            <div className="saved-view-controls">
              {saved.map((v, index) => (
                <span key={index}>
                  <button
                    className="text-button"
                    onClick={() => applySaved(index)}
                  >
                    {v.name}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete saved view ${v.name}`}
                    onClick={() => {
                      const next = saved.filter((_, i) => i !== index);
                      setSaved(next);
                      localStorage.setItem(
                        storageKey,
                        JSON.stringify({ filters, saved: next }),
                      );
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                aria-label="Name current lead view"
                value={viewName}
                maxLength={40}
                placeholder="Name this view"
                onChange={(e) => setViewName(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!viewName.trim() || saved.length >= 8}
                onClick={() => {
                  const next = [...saved, { name: viewName.trim(), filters }];
                  setSaved(next);
                  setViewName("");
                  localStorage.setItem(
                    storageKey,
                    JSON.stringify({ filters, saved: next }),
                  );
                }}
              >
                Save view
              </Button>
            </div>
            <p>Saved in this browser for this workspace. Up to 8 views.</p>
          </details>
          <label className="pipeline-sort">
            <span>Sort by</span>
            <select
              aria-label="Sort leads"
              value={filters.sort}
              onChange={(e) => change({ sort: e.target.value })}
            >
              <option value="opportunity">Strongest opportunity</option>
              <option value="recent">Recently updated</option>
              <option value="name">Store name</option>
            </select>
          </label>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReload((x) => x + 1)}
            >
              Retry
            </Button>
          </div>
        )}
        <div
          className={`pipeline-progress ${loading ? "on" : ""}`}
          aria-hidden="true"
        />
        <div
          className={`table-scroll ${loading && visible.length ? "is-refreshing" : ""}`}
          aria-busy={loading}
        >
          <table className="prospect-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select visible leads"
                    checked={
                      !!visible.length &&
                      visible.every((l) => selected.includes(l.id))
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? visible.map((l) => l.id) : [],
                      )
                    }
                  />
                </th>
                <th>Store</th>
                <th>Main opportunity</th>
                <th>Contact</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                !visible.length &&
                Array.from({ length: 5 }, (_, index) => (
                  <tr
                    className="pipeline-skeleton-row"
                    key={`loading-${index}`}
                    aria-hidden="true"
                  >
                    {Array.from({ length: 5 }, (_, cell) => (
                      <td key={cell}>
                        <span className="pipeline-skeleton-line" />
                      </td>
                    ))}
                  </tr>
                ))}
              {visible.map((l) => {
                const i = leadIntelligence(l);
                const score = leadScoreFor(l);
                const email = i.emails[0];
                return (
                  <tr key={l.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${l.name}`}
                        checked={selected.includes(l.id)}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, l.id]
                              : s.filter((id) => id !== l.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="pipeline-business">
                        <span
                          className={`brand-avatar ${l.color ?? "sage"}`}
                          aria-hidden="true"
                        >
                          {l.name.slice(0, 1)}
                        </span>
                        <div className="pipeline-business-text">
                          <button
                            className="pipeline-store"
                            onClick={() => onOpen(l)}
                          >
                            <strong title={l.name}>{l.name}</strong>
                          </button>
                          <span className="pipeline-domain" title={l.domain}>
                            {l.domain}
                          </span>
                          <span className="pipeline-secondary">
                            {l.industry}
                            {" · "}
                            <span
                              title={
                                l.country
                                  ? countryNames[l.country]
                                  : "Country unverified"
                              }
                            >
                              {l.country ?? "Unverified country"}
                            </span>
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong className="pipeline-opportunity">{i.main}</strong>
                      <div className="pipeline-opportunity-meta">
                        <span
                          className={`strength strength-${i.rank}`}
                          title={i.reason}
                        >
                          {i.label}
                        </span>
                        <span
                          className="pipeline-score"
                          title="Research score. Open the lead to see why."
                        >
                          {score.researchScore}/100
                        </span>
                        {score.brand &&
                          score.brand.verdict !== "independent" && (
                            <span
                              className={`pipeline-brand ${score.brand.verdict}`}
                              title={score.brand.signals
                                .map((x) => x.label)
                                .join(". ")}
                            >
                              {score.brand.verdict === "likely_agency"
                                ? "Has its own team"
                                : "Possibly a big brand"}
                            </span>
                          )}
                        <span className="pipeline-mobile">
                          {l.performance !== null
                            ? `Mobile ${Math.round(l.performance)}/100`
                            : "Not measured"}
                        </span>
                      </div>
                      <small className="pipeline-audit-date">
                        {l.contact && !l.outcome ? (
                          <span
                            className={`pipeline-touch${isDue(l) ? " due" : ""}`}
                          >
                            {contactLabel[l.contact.kind]}{" "}
                            {formatDate(l.contact.at, true)}
                            {l.contact.follow_up_at &&
                              ` · ${followUpLabel(l.contact.follow_up_at)}`}
                          </span>
                        ) : (
                          <>Audited {formatDate(l.audited_at, true)}</>
                        )}
                      </small>
                    </td>
                    <td>
                      {email ? (
                        <>
                          <div className="pipeline-email-line">
                            <a
                              className="pipeline-email"
                              href={`mailto:${email.email}`}
                              title={email.email}
                            >
                              {email.email}
                            </a>
                            <button
                              className="pipeline-copy"
                              aria-label={`${copiedEmail === email.email ? "Copied" : "Copy"} email for ${l.name}`}
                              title={
                                copiedEmail === email.email
                                  ? "Copied"
                                  : "Copy email"
                              }
                              onClick={() => void copyEmail(email.email)}
                            >
                              {copiedEmail === email.email ? (
                                <Check size={14} />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                          </div>
                          <div className="pipeline-contact-meta">
                            <small>
                              {l.preferred_email === email.email
                                ? "Preferred · "
                                : ""}
                              {contactCategory(email.email) === "Unknown"
                                ? "Public email"
                                : contactCategory(email.email)}
                            </small>
                            <button
                              className="text-button"
                              onClick={() => onOpen(l)}
                            >
                              View{" "}
                              {i.emails.length > 1
                                ? `${i.emails.length} contacts`
                                : "contact & source"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="unknown">No public email found</span>
                          <small>
                            {l.contact_url
                              ? "Contact page available"
                              : "Contact research needed"}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <span
                        className={`review-state ${l.permission === "approved" ? "approved" : ""}`}
                      >
                        {i.review}
                      </span>
                      <button
                        className="text-button pipeline-next"
                        onClick={() => onOpen(l)}
                      >
                        {i.next}
                        <ArrowUpRight size={14} />
                      </button>
                      <button
                        className="text-button pipeline-report"
                        disabled={!l.report_id}
                        aria-label={`Download report for ${l.name}`}
                        onClick={() => onReport(l)}
                      >
                        <FileText size={14} /> Report
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visible.length && !loading && (
            <div className="empty-state">
              <Search size={25} />
              <h3>{loading ? "Loading leads…" : "No leads in this view"}</h3>
              <p>
                {loading
                  ? "Checking your workspace history."
                  : "Clear the filters, import stores, or start a focused discovery campaign."}
              </p>
              {!loading && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    change(defaults);
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </div>
        <span className="sr-only" role="status">
          {copiedEmail ? `Copied ${copiedEmail}` : ""}
        </span>
        <div className="table-footer">
          <span>
            {loading
              ? "Updating…"
              : `Showing ${count ? page * size + 1 : 0}–${Math.min((page + 1) * size, count)} of ${count} leads`}
            {live ? " · Full workspace history" : ""}
          </span>
          <div className="pagination">
            <select
              aria-label="Leads per page"
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(0);
                setSelected([]);
              }}
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous leads page"
              disabled={page === 0 || loading}
              onClick={() => {
                setPage((p) => p - 1);
                setSelected([]);
              }}
            >
              <ChevronLeft size={16} />
            </Button>
            <span>
              {page + 1} / {pages}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next leads page"
              disabled={page + 1 >= pages || loading}
              onClick={() => {
                setPage((p) => p + 1);
                setSelected([]);
              }}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </section>
      <DomainImport
        open={importOpen}
        onClose={() => setImportOpen(false)}
        queries={queries}
        live={live}
        onDone={() => setReload((x) => x + 1)}
      />
      <AuditRequest
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        live={live}
        onDone={() => setReload((x) => x + 1)}
      />
    </>
  );
}
