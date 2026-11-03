import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Search,
  SlidersHorizontal,
  ExternalLink,
  Check,
  ArrowUpRight,
  Mail,
} from "lucide-react";
import { leadIntelligence, rankedEmails } from "../../shared/lead-intelligence";
import type { Lead, Country } from "../../shared/types";
import { countryNames } from "../../shared/types";
import { csvCell } from "../../shared/scoring";
import { lighthouseScore } from "../../shared/lighthouse-score";
import { Button } from "./ui/button";
import { formatDate, downloadBlob } from "../lib";
export const flags: Record<Country, string> = {
  US: "🇺🇸",
  GB: "🇬🇧",
  CA: "🇨🇦",
  AU: "🇦🇺",
};
export function Score({
  value,
  inverse = false,
}: {
  value: number | null;
  inverse?: boolean;
}) {
  const { score, band } = lighthouseScore(value);
  const color = inverse
    ? score !== null && score >= 70
      ? "green"
      : score !== null && score >= 50
        ? "amber"
        : "muted"
    : band === "poor"
      ? "red"
      : band === "average"
        ? "amber"
        : band === "good"
          ? "green"
          : "muted";
  return score === null ? (
    <span className="unknown" title="No verified measurement">
      —
    </span>
  ) : (
    <span className={`score score-${color}`}>
      <i />
      {score}
    </span>
  );
}
export function Priority({ value }: { value: number }) {
  return (
    <span
      className={`priority ${value >= 70 ? "priority-a" : value >= 50 ? "priority-b" : "priority-hold"}`}
    >
      {value >= 70 ? (
        <>
          <span>A</span> Priority A
        </>
      ) : value >= 50 ? (
        <>
          <span>B</span> Priority B
        </>
      ) : (
        "Hold"
      )}
      {value > 0 && <b>{value}</b>}
    </span>
  );
}
export function LeadTable({
  leads,
  onOpen,
  onReport,
  compact = false,
  rowAction,
  title = "Research pipeline",
  description = "Evidence-backed opportunities, ready for a closer look.",
  initialSearch = "",
}: {
  leads: Lead[];
  onOpen: (lead: Lead) => void;
  onReport: (lead: Lead) => void;
  compact?: boolean;
  /** Adds a labelled button beside the store name that opens the row. */
  rowAction?: string;
  title?: string;
  description?: string;
  initialSearch?: string;
}) {
  const [search, setSearch] = useState(initialSearch),
    [country, setCountry] = useState("all"),
    [band, setBand] = useState("all"),
    [stage, setStage] = useState("all"),
    [filters, setFilters] = useState(false),
    [sort, setSort] = useState<"priority" | "performance" | "name">("priority"),
    [ascending, setAscending] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [page, setPage] = useState(0);
  const navigate = useNavigate();
  const size = compact ? 5 : 10;
  const filtered = useMemo(
    () =>
      leads
        .filter(
          (l) =>
            `${l.name} ${l.domain} ${l.industry} ${l.emails?.map((contact) => contact.email).join(" ") ?? ""}`
              .toLowerCase()
              .includes(search.toLowerCase()) &&
            (country === "all" || l.country === country) &&
            (stage === "all" || l.stage === stage) &&
            (band === "all" ||
              (band === "A"
                ? l.priority >= 70
                : band === "B"
                  ? l.priority >= 50 && l.priority < 70
                  : l.priority < 50)),
        )
        .sort((a, b) => {
          const factor = ascending ? 1 : -1;
          return sort === "name"
            ? a.name.localeCompare(b.name) * factor
            : ((a[sort] ?? -1) - (b[sort] ?? -1)) * factor;
        }),
    [leads, search, country, band, stage, sort, ascending],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / size)),
    safePage = Math.min(page, pages - 1);
  const visible = filtered.slice(safePage * size, (safePage + 1) * size);
  function exportCsv() {
    const items = selected.length
      ? filtered.filter((l) => selected.includes(l.id))
      : filtered;
    const rows = [
      [
        "Data source",
        "Brand",
        "Domain",
        "Public emails",
        "Email sources",
        "Country",
        "Industry",
        "Activity confidence",
        "SEO",
        "Mobile performance",
        "Main opportunity",
        "CRO heuristic",
        "Gated priority",
        "Stage",
        "Audit date",
        "Contact permission",
      ],
      ...items.map((l) => [
        l.domain.endsWith(".example")
          ? "SYNTHETIC DEMO"
          : "Live audit evidence",
        l.name,
        l.domain,
        l.emails?.map((contact) => contact.email).join("; ") ?? "",
        l.emails?.map((contact) => contact.source_url).join("; ") ?? "",
        l.country ?? "Unknown",
        l.industry,
        l.activity ?? "Unknown",
        l.seo ?? "Unavailable",
        l.performance ?? "Unavailable",
        leadIntelligence(l).main,
        l.cro ?? "Unknown",
        l.priority,
        l.stage,
        l.audited_at,
        l.permission,
      ]),
    ];
    downloadBlob(
      new Blob(
        ["\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
      "scout-leads.csv",
    );
  }
  function order(field: typeof sort) {
    if (sort === field) setAscending(!ascending);
    else {
      setSort(field);
      setAscending(field === "name");
    }
  }
  return (
    <section className="panel leads-panel">
      <div className="panel-heading">
        <div>
          <h2>
            {title} <span className="count-badge">{leads.length}</span>
          </h2>
          <p>{description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download size={16} />
          {selected.length
            ? `Export ${selected.length} selected`
            : "Export CSV"}
        </Button>
      </div>
      <div className="table-toolbar">
        <div className="table-tabs">
          <button
            className={band === "all" ? "active" : ""}
            onClick={() => {
              setBand("all");
              setPage(0);
            }}
          >
            All prospects <span>{leads.length}</span>
          </button>
          <button
            className={band === "A" ? "active" : ""}
            onClick={() => {
              setBand("A");
              setPage(0);
            }}
          >
            Priority A{" "}
            <span>{leads.filter((l) => l.priority >= 70).length}</span>
          </button>
          <button
            className={band === "hold" ? "active" : ""}
            onClick={() => {
              setBand("hold");
              setPage(0);
            }}
          >
            Needs review
          </button>
        </div>
        <div className="table-controls">
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Search prospects"
              placeholder="Search prospects..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={filters}
            onClick={() => setFilters(!filters)}
          >
            <SlidersHorizontal size={14} />
            Filters
            {country !== "all" || stage !== "all" ? (
              <i className="filter-dot" />
            ) : null}
          </Button>
        </div>
      </div>
      {filters && (
        <div className="filter-row">
          <label>
            Country
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All countries</option>
              {Object.entries(countryNames).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lead stage
            <select
              value={stage}
              onChange={(e) => {
                setStage(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All stages</option>
              {["new", "reviewing", "qualified", "hold", "suppressed"].map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ),
              )}
            </select>
          </label>
          <button
            className="text-button"
            onClick={() => {
              setCountry("all");
              setStage("all");
              setSearch("");
              setBand("all");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="checkbox-cell">
                <input
                  aria-label="Select all visible prospects"
                  type="checkbox"
                  checked={
                    !!visible.length &&
                    visible.every((l) => selected.includes(l.id))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [
                            ...new Set([
                              ...selected,
                              ...visible.map((l) => l.id),
                            ]),
                          ]
                        : selected.filter(
                            (id) => !visible.some((l) => l.id === id),
                          ),
                    )
                  }
                />
              </th>
              <th>
                <button onClick={() => order("name")}>
                  Brand <ArrowUpDown size={14} />
                </button>
              </th>
              {rowAction && <th aria-label={rowAction} />}
              <th>Public email</th>
              <th>Country</th>
              <th>Industry</th>
              <th>
                <button onClick={() => order("performance")}>
                  Performance <ArrowUpDown size={14} />
                </button>
              </th>
              <th>SEO</th>
              <th>Main opportunity</th>
              <th>
                <button onClick={() => order("priority")}>
                  Outreach priority <ArrowDown size={14} />
                </button>
              </th>
              <th aria-label="Audit report" />
            </tr>
          </thead>
          <tbody>
            {visible.map((lead, index) => (
              <tr
                key={lead.id}
                className={selected.includes(lead.id) ? "selected" : ""}
              >
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    aria-label={`Select ${lead.name}`}
                    checked={selected.includes(lead.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, lead.id]
                          : selected.filter((id) => id !== lead.id),
                      )
                    }
                  />
                </td>
                <td>
                  <button className="brand-cell" onClick={() => onOpen(lead)}>
                    <span
                      className={`brand-avatar ${lead.color ?? ["sage", "pink", "sand", "blue"][index % 4]}`}
                    >
                      {lead.name
                        .split(" ")
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <span>
                      <strong title={lead.name}>{lead.name}</strong>
                      <small>
                        {lead.domain}
                        <ArrowUpRight size={14} />
                      </small>
                    </span>
                  </button>
                </td>
                {rowAction && (
                  <td>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`${rowAction} ${lead.name}`}
                      onClick={() => onOpen(lead)}
                    >
                      {rowAction}
                    </Button>
                  </td>
                )}
                <td>
                  {lead.emails?.length ? (
                    <div className="email-cell">
                      <a
                        href={`mailto:${rankedEmails(lead.emails, lead.preferred_email, lead.mail_checks)[0].email}`}
                      >
                        <Mail size={14} />
                        {
                          rankedEmails(
                            lead.emails,
                            lead.preferred_email,
                            lead.mail_checks,
                          )[0].email
                        }
                      </a>
                      <button
                        className="text-button"
                        onClick={() => onOpen(lead)}
                      >
                        {lead.emails.length > 1
                          ? `+${lead.emails.length - 1} more · View sources`
                          : "View source"}
                      </button>
                    </div>
                  ) : (
                    <span className="unknown">Not found</span>
                  )}
                </td>
                <td>
                  <span className="country-cell">
                    {lead.country ? (
                      <>
                        <span>{flags[lead.country]}</span>
                        {lead.country === "GB" ? "UK" : lead.country}
                      </>
                    ) : (
                      <span className="unknown">Unknown</span>
                    )}
                  </span>
                </td>
                <td>
                  <span className="industry-cell">{lead.industry}</span>
                </td>
                <td>
                  <Score value={lead.performance} />
                </td>
                <td>
                  <Score value={lead.seo} />
                </td>
                <td>
                  <span title={leadIntelligence(lead).reason}>
                    {leadIntelligence(lead).main}
                  </span>
                </td>
                <td>
                  <Priority value={lead.priority} />
                </td>
                <td>
                  <button
                    className="icon-button"
                    title={
                      lead.report_id
                        ? "Download audit report"
                        : "Report unavailable"
                    }
                    disabled={!lead.report_id}
                    aria-label={`Download report for ${lead.name}`}
                    onClick={() => onReport(lead)}
                  >
                    <FileText size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <div className="empty-state">
            <Search size={28} />
            <h3>No matching prospects</h3>
            <p>Try another search or clear your filters.</p>
            <button
              className="text-button"
              onClick={() => {
                setSearch("");
                setCountry("all");
                setStage("all");
                setBand("all");
              }}
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>
      <div className="table-footer">
        <span>
          {selected.length > 0 ? (
            <>
              <Check size={14} /> {selected.length} selected ·{" "}
            </>
          ) : null}
          Showing {filtered.length ? safePage * size + 1 : 0}–
          {Math.min((safePage + 1) * size, filtered.length)} of{" "}
          {filtered.length} prospects
        </span>
        {compact ? (
          <button className="text-button" onClick={() => navigate("/leads")}>
            View all prospects <ArrowUpRight size={14} />
          </button>
        ) : (
          <div className="pagination">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous page"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <span>
              {safePage + 1} / {pages}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next page"
              disabled={safePage + 1 >= pages}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
