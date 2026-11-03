import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { lighthouseScore } from "../../shared/lighthouse-score";
import { publicActivityUrl } from "../../shared/job-activity";

const categories = [
  ["performance", "Performance"],
  ["accessibility", "Accessibility"],
  ["best-practices", "Best Practices"],
  ["seo", "SEO"],
] as const;
export type ScoreDevice = {
  scores: Record<string, number | null>;
  note: string;
  testedAt?: string;
  url?: string;
};
export function PageSpeedAudit({
  mobile,
  desktop,
  pending = false,
}: {
  mobile: ScoreDevice;
  desktop: ScoreDevice;
  pending?: boolean;
}) {
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const current = device === "mobile" ? mobile : desktop;
  const url = publicActivityUrl(current.url);
  return (
    <section
      className="pagespeed-audit"
      aria-label="PageSpeed audit scores"
      aria-busy={pending}
    >
      <header className="pagespeed-heading">
        <div>
          <h3>PageSpeed audit</h3>
          <p>Lighthouse lab results</p>
        </div>
        <div
          className="pagespeed-devices"
          role="group"
          aria-label="Test device"
        >
          <button
            type="button"
            aria-pressed={device === "mobile"}
            onClick={() => setDevice("mobile")}
          >
            <Smartphone size={16} />
            Mobile
          </button>
          <button
            type="button"
            aria-pressed={device === "desktop"}
            onClick={() => setDevice("desktop")}
          >
            <Monitor size={16} />
            Desktop
          </button>
        </div>
      </header>
      <div className="pagespeed-gauges">
        {categories.map(([key, label]) => {
          const {
            score,
            band,
            label: status,
          } = lighthouseScore(current.scores[key]);
          return (
            <div className={`pagespeed-category pagespeed-${band}`} key={key}>
              <div
                className="pagespeed-gauge"
                role="img"
                aria-label={`${device} ${label}: ${score === null ? "unavailable" : `${score} out of 100, ${status}`}`}
              >
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <circle
                    className="pagespeed-gauge-track"
                    cx="50"
                    cy="50"
                    r="44"
                  />
                  {score !== null && (
                    <circle
                      className="pagespeed-gauge-value"
                      cx="50"
                      cy="50"
                      r="44"
                      pathLength="100"
                      strokeDasharray={`${score} 100`}
                      transform="rotate(-90 50 50)"
                    />
                  )}
                </svg>
                <span aria-hidden="true">{score ?? "—"}</span>
              </div>
              <strong>{label}</strong>
              <small>{status}</small>
            </div>
          );
        })}
      </div>
      <div className="pagespeed-legend" aria-label="Score ranges">
        <span>
          <i className="pagespeed-range-poor" />
          0–49
        </span>
        <span>
          <i className="pagespeed-range-average" />
          50–89
        </span>
        <span>
          <i className="pagespeed-range-good" />
          90–100
        </span>
      </div>
      <footer className="pagespeed-source">
        <p>{pending ? "Loading saved measurements…" : current.note}</p>
        {current.testedAt && (
          <time dateTime={current.testedAt}>
            {new Intl.DateTimeFormat("en-PH", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Manila",
            }).format(new Date(current.testedAt))}{" "}
            PHT
          </time>
        )}
        {url && (
          <a href={url} target="_blank" rel="noreferrer" title={url}>
            {url}
          </a>
        )}
        <p className="pagespeed-scope">
          Automated checks of the tested page. Scores can vary between runs.
        </p>
      </footer>
    </section>
  );
}
