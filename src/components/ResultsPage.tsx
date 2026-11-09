import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { rate, type OutreachResults } from "../../shared/outreach-results";
import { countryNames, type Country } from "../../shared/types";
import { api } from "../lib";
import "../results.css";

const periods = [
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["365", "Last 12 months"],
  ["all", "All time"],
] as const;
type Period = (typeof periods)[number][0];

/** What your outreach led to: emails, replies, calls and wins. */
export function ResultsPage({ demo }: { demo: boolean }) {
  const [period, setPeriod] = useState<Period>(() => {
    try {
      const saved = localStorage.getItem("scout-results-period");
      return periods.some(([p]) => p === saved) ? (saved as Period) : "90";
    } catch {
      return "90";
    }
  });
  const [data, setData] = useState<OutreachResults | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    api<OutreachResults>(`/results?days=${period}`)
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Couldn't load results.");
      });
    return () => {
      cancelled = true;
    };
  }, [period, demo]);
  const choose = (p: Period) => {
    setPeriod(p);
    try {
      localStorage.setItem("scout-results-period", p);
    } catch {
      /* optional */
    }
  };

  if (demo)
    return (
      <section className="panel results-empty">
        <p>
          Results come from your own outreach, so the sample workspace has none.
        </p>
      </section>
    );
  return (
    <div className="results">
      <div className="results-period" role="group" aria-label="Period">
        {periods.map(([p, label]) => (
          <button
            key={p}
            type="button"
            aria-pressed={period === p}
            className={period === p ? "active" : ""}
            onClick={() => choose(p)}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : !data ? (
        <section className="panel results-empty" role="status">
          <LoaderCircle size={18} className="spin" /> Loading results…
        </section>
      ) : data.emailed === 0 && data.called === 0 && data.won === 0 ? (
        <section className="panel results-empty">
          <strong>Nothing logged in this period yet</strong>
          <p>
            Results count what you log on each lead: Emailed, Called, Replied,
            Call booked, and won or lost. Send a first email and log it, and it
            shows up here.
          </p>
        </section>
      ) : (
        <Results data={data} />
      )}
    </div>
  );
}

function Results({ data }: { data: OutreachResults }) {
  const steps = [
    ["Approved", data.approved, null],
    ["Emailed", data.emailed, `${data.emails_sent} emails sent`],
    ["Replied", data.replied, `${rate(data.replied, data.emailed)} of emailed`],
    [
      "Call booked",
      data.calls_booked,
      `${rate(data.calls_booked, data.replied)} of replies`,
    ],
    [
      "Won",
      data.won,
      data.won + data.lost
        ? `${rate(data.won, data.won + data.lost)} of closed`
        : "None closed yet",
    ],
  ] as const;
  const after = data.replied_after;
  const groups = (
    title: string,
    rows: OutreachResults["by_industry"],
    name: (label: string) => string = (l) => l,
  ) =>
    rows.length > 0 && (
      <section className="panel results-table">
        <h2>{title}</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">
                {title === "By country" ? "Country" : "Industry"}
              </th>
              <th scope="col">Emailed</th>
              <th scope="col">Replied</th>
              <th scope="col">Reply rate</th>
              <th scope="col">Won</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((g) => (
              <tr key={g.label}>
                <th scope="row">{name(g.label)}</th>
                <td>{g.emailed}</td>
                <td>{g.replied}</td>
                <td>{rate(g.replied, g.emailed)}</td>
                <td>{g.won}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  return (
    <>
      <section className="panel results-funnel" aria-label="Outreach funnel">
        {steps.map(([label, n, note]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{n}</strong>
            {note && <span>{note}</span>}
          </div>
        ))}
      </section>
      <div className="results-grid">
        <section className="panel results-table">
          <h2>Which email got the reply</h2>
          {data.replied ? (
            <ul className="results-bars">
              {(
                [
                  ["First email", after.first],
                  ["Follow-up", after.follow_up],
                  ["Final email", after.final],
                  ["Before any email (a call or a reply to you)", after.other],
                ] as const
              )
                .filter(([, n], i) => i < 3 || n > 0)
                .map(([label, n]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <span className="results-bar" aria-hidden="true">
                      <i style={{ width: `${(n / data.replied) * 100}%` }} />
                    </span>
                    <b>{n}</b>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="results-note">No replies in this period yet.</p>
          )}
        </section>
        <section className="panel results-table">
          <h2>Why leads were lost</h2>
          {data.lost_reasons.length ? (
            <ul className="results-bars">
              {data.lost_reasons.map((r) => (
                <li key={r.reason}>
                  <span>{r.reason}</span>
                  <span className="results-bar" aria-hidden="true">
                    <i style={{ width: `${(r.count / data.lost) * 100}%` }} />
                  </span>
                  <b>{r.count}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="results-note">No leads marked lost in this period.</p>
          )}
        </section>
      </div>
      {groups("By industry", data.by_industry)}
      {groups(
        "By country",
        data.by_country,
        (c) => countryNames[c as Country] ?? c,
      )}
    </>
  );
}
