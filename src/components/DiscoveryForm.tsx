import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Globe2,
  Search,
  Settings2,
  ShieldCheck,
  Timer,
  Workflow,
  Save,
  LoaderCircle,
  PlugZap,
  ExternalLink,
} from "lucide-react";
import {
  defaultSettings,
  countryNames,
  industries,
  moderateScreening,
  type DiscoverySettings,
} from "../../shared/types";
import { Button } from "./ui/button";
import {
  keywordLibrary,
  customKeywords,
} from "../../shared/discovery-keywords";
export function DiscoveryForm({
  initial,
  onSave,
  onRun,
  demo,
  integrations,
  settingsPage = false,
}: {
  initial?: DiscoverySettings;
  onSave: (s: DiscoverySettings) => Promise<void>;
  onRun: () => void;
  demo: boolean;
  integrations: Record<string, boolean>;
  settingsPage?: boolean;
}) {
  const [form, setForm] = useState<DiscoverySettings>(
      initial ?? defaultSettings,
    ),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState("");
  // A stop action updates the saved schedule without discarding other form edits.
  useEffect(() => {
    if (initial) setForm((s) => ({ ...s, enabled: initial.enabled }));
  }, [initial?.enabled]);
  const field = <K extends keyof DiscoverySettings>(
    key: K,
    value: DiscoverySettings[K],
  ) => {
    setForm((s) => ({ ...s, [key]: value }));
    setSaved(false);
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.countries.length) {
      setError("Select at least one target country.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(form);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-layout">
      <form className="settings-main" onSubmit={save}>
        <section className="panel form-panel">
          <div className="section-heading">
            <span className="section-icon">
              <Globe2 size={18} />
            </span>
            <div>
              <h2>Define your ideal prospect</h2>
              <p>
                Discover relevant businesses. Let the evidence qualify them.
              </p>
            </div>
          </div>
          <div className="campaign-presets">
            <span>Focus this campaign</span>
            {[
              ["Australian skincare", "AU", "Beauty & skincare"],
              ["UK fashion boutiques", "GB", "Fashion & apparel"],
              ["US home stores", "US", "Home & furniture"],
            ].map(([name, country, industry]) => (
              <button
                type="button"
                key={name}
                onClick={() => {
                  setForm((f) => ({
                    ...f,
                    name,
                    countries: [country as keyof typeof countryNames],
                    industries: [industry],
                  }));
                  setSaved(false);
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <label className="field-label">
            Research name
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => field("name", e.target.value)}
            />
          </label>
          <div className="field-label">
            Target countries
            <span className="field-hint">
              A store’s country must be supported by public or provider
              evidence.
            </span>
            <div className="country-options">
              {Object.entries(countryNames).map(([code, name]) => (
                <button
                  key={code}
                  type="button"
                  className={`country-option ${form.countries.includes(code as keyof typeof countryNames) ? "chosen" : ""}`}
                  aria-pressed={form.countries.includes(
                    code as keyof typeof countryNames,
                  )}
                  onClick={() =>
                    field(
                      "countries",
                      form.countries.includes(code as keyof typeof countryNames)
                        ? form.countries.filter((c) => c !== code)
                        : [
                            ...form.countries,
                            code as keyof typeof countryNames,
                          ],
                    )
                  }
                >
                  <span>
                    {{ US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", AU: "🇦🇺" }[code]}
                  </span>
                  {name}
                  {form.countries.includes(
                    code as keyof typeof countryNames,
                  ) && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>
          <div className="field-label">
            Industries
            <div className="chip-options">
              {industries.map((industry) => (
                <button
                  type="button"
                  key={industry}
                  aria-pressed={form.industries.includes(industry)}
                  className={form.industries.includes(industry) ? "chosen" : ""}
                  onClick={() =>
                    field(
                      "industries",
                      form.industries.includes(industry)
                        ? form.industries.filter((i) => i !== industry)
                        : [...form.industries, industry],
                    )
                  }
                >
                  {form.industries.includes(industry) && <Check size={14} />}{" "}
                  {industry}
                </button>
              ))}
            </div>
          </div>
          <label className="field-label">
            Additional search phrases <span className="optional">Optional</span>
            <span className="field-hint">
              Separate phrases with commas or new lines. Scout rotates them
              individually.
            </span>
            <textarea
              rows={3}
              placeholder={"sustainable furniture\nindependent skincare"}
              maxLength={5000}
              value={form.keywords}
              onChange={(e) => field("keywords", e.target.value)}
            />
          </label>
          <label className="switch-row">
            <span>
              <strong>Use industry keyword library</strong>
              <small>
                Rotate product niches within the industries selected above.
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={form.keyword_library !== false}
              onChange={(e) => field("keyword_library", e.target.checked)}
            />
          </label>
          <label className="switch-row">
            <span>
              <strong>Learn from search outcomes</strong>
              <small>
                For Tavily, favor queries that produced published audits and
                business/support contacts on every fourth search. Other searches
                explore the remaining phrases and formats.
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={form.adaptive_queries !== false}
              onChange={(e) => field("adaptive_queries", e.target.checked)}
            />
          </label>
          <label className="field-label">
            Exclude irrelevant domains
            <span className="field-hint">
              One domain per line, up to 40. Use this for publishers or agencies
              that keep appearing.
            </span>
            <textarea
              rows={3}
              value={(form.excluded_domains ?? []).join("\n")}
              onChange={(e) =>
                field(
                  "excluded_domains",
                  e.target.value
                    .split(/[\n,]+/)
                    .map((v) => v.trim().toLowerCase())
                    .filter(Boolean),
                )
              }
            />
          </label>
          <details className="keyword-library">
            <summary>
              {form.industries.reduce(
                (count, industry) =>
                  count + (keywordLibrary[industry]?.length ?? 0),
                0,
              )}{" "}
              industry phrases · {customKeywords(form.keywords).length}{" "}
              additional phrases
            </summary>
            {form.industries.map((industry) => (
              <div key={industry}>
                <strong>{industry}</strong>
                <p>
                  {keywordLibrary[industry]?.join(" · ") ??
                    "General retail keywords"}
                </p>
              </div>
            ))}
          </details>
        </section>
        <section className="panel form-panel">
          <div className="section-heading">
            <span className="section-icon">
              <Search size={18} />
            </span>
            <div>
              <h2>Discovery & screening</h2>
              <p>Use an authorized provider and set your initial thresholds.</p>
            </div>
          </div>
          <div className="screening-preset">
            <div>
              <strong>Find moderate opportunities</strong>
              <p>
                Up to 10 stores · Mobile ≤75 · SEO ≤85 · Supported frontend
                issues
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setForm((current) => ({ ...current, ...moderateScreening }));
                setSaved(false);
              }}
            >
              Use moderate settings
            </Button>
          </div>
          <div className="form-grid">
            <label className="field-label">
              Discovery provider
              <select
                value={form.provider}
                onChange={(e) =>
                  field(
                    "provider",
                    e.target.value as DiscoverySettings["provider"],
                  )
                }
              >
                <option value="storeleads">Store Leads API</option>
                <option value="brave">Brave Search API</option>
                <option value="tavily">Tavily Search API</option>
              </select>
            </label>
            <label className="field-label">
              Stores per run
              <input
                required
                type="number"
                min={1}
                max={50}
                value={form.batch_size}
                onChange={(e) => field("batch_size", Number(e.target.value))}
              />
            </label>
            {form.provider === "tavily" && (
              <label className="field-label">
                Maximum searches per run
                <select
                  value={form.searches_per_run ?? 1}
                  onChange={(e) =>
                    field("searches_per_run", Number(e.target.value))
                  }
                >
                  <option value={1}>1 basic search · up to 1 credit</option>
                  <option value={2}>2 basic searches · up to 2 credits</option>
                  <option value={3}>3 basic searches · up to 3 credits</option>
                </select>
              </label>
            )}
            <label className="field-label">
              Mobile performance ≤
              <input
                required
                type="number"
                min={0}
                max={100}
                value={form.mobile_threshold}
                onChange={(e) =>
                  field("mobile_threshold", Number(e.target.value))
                }
              />
            </label>
            <label className="field-label">
              SEO score ≤
              <input
                required
                type="number"
                min={0}
                max={100}
                value={form.seo_threshold}
                onChange={(e) => field("seo_threshold", Number(e.target.value))}
              />
            </label>
            <label className="field-label">
              Daily total provider request cap
              <input
                required
                type="number"
                min={1}
                max={10000}
                value={form.daily_api_budget}
                onChange={(e) =>
                  field("daily_api_budget", Number(e.target.value))
                }
              />
            </label>
          </div>
          <div className="form-grid">
            <label className="field-label">
              Daily discovery request cap
              <input
                type="number"
                min="0"
                max="10000"
                value={form.discovery_daily_budget ?? form.daily_api_budget}
                onChange={(e) =>
                  field("discovery_daily_budget", Number(e.target.value))
                }
              />
            </label>
            <label className="field-label">
              Daily audit request cap
              <input
                type="number"
                min="0"
                max="10000"
                value={form.audit_daily_budget ?? form.daily_api_budget}
                onChange={(e) =>
                  field("audit_daily_budget", Number(e.target.value))
                }
              />
            </label>
          </div>
          <p className="field-hint">
            Workspace-wide limits reset at midnight UTC. Both the total and
            category cap apply. Set a category to 0 to pause its provider
            requests. One qualifying audit can use 6 PageSpeed requests.
          </p>
          {form.provider === "tavily" && (
            <div className="inline-note">
              Up to {form.searches_per_run ?? 1} basic search
              {(form.searches_per_run ?? 1) === 1 ? "" : "es"} per run return up
              to {(form.searches_per_run ?? 1) * 20} results before duplicate
              filtering. Searching stops when the store target is reached.
              Keywords, search styles, countries, and industries rotate; fewer
              stores may qualify. The search limit includes job retries. Search
              credits do not equal stores.
            </div>
          )}
          <label className="switch-row">
            <span>
              <strong>Include supported frontend findings</strong>
              <small>
                Also audit stores with recorded frontend, image or accessibility
                issues. No redesign score is inferred.
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={form.include_frontend_findings !== false}
              onChange={(e) =>
                field("include_frontend_findings", e.target.checked)
              }
            />
          </label>
          <h3 className="ideal-client-heading">Ideal client</h3>
          <p className="field-hint">
            Optional. Stores outside these limits are set aside before any paid
            PageSpeed request. Stores whose public catalog can&apos;t be read
            are kept, because unknown isn&apos;t a mismatch. Prices use each
            store&apos;s own currency.
          </p>
          <div className="form-grid">
            {(
              [
                ["min_products", "Minimum products", 1],
                ["max_products", "Maximum products", 1],
                ["min_price", "Minimum typical price", 0.01],
                ["max_price", "Maximum typical price", 0.01],
                ["active_within_days", "New product within (days)", 1],
              ] as const
            ).map(([key, label, step]) => (
              <label className="field-label" key={key}>
                {label}
                <input
                  type="number"
                  min={key === "active_within_days" ? 1 : 0}
                  step={step}
                  placeholder="Any"
                  value={form.ideal_client?.[key] ?? ""}
                  onChange={(e) =>
                    field("ideal_client", {
                      ...form.ideal_client,
                      [key]:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="inline-note">
            <ShieldCheck size={16} />
            <span>
              A lower performance or SEO score means more room to improve. Any
              one matching condition can trigger a deeper audit; setting
              performance or SEO to 100 includes even healthy stores. Unknown
              scores alone do not qualify. Every store must first pass Shopify,
              activity, and country checks.
            </span>
          </div>
          <p className="field-hint">
            Stores per run is a maximum number queued for screening, not a
            guaranteed number of leads. Each store uses 2 PageSpeed requests
            initially, then 4 more if it qualifies. The daily budget counts all
            provider requests.
          </p>
        </section>
        <section className="panel form-panel">
          <div className="section-heading">
            <span className="section-icon">
              <Workflow size={18} />
            </span>
            <div>
              <h2>Automation & audit modules</h2>
              <p>
                Runs while the background worker is running. A local worker
                needs your computer awake.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field-label">
              Run interval
              <select
                value={
                  [24, 168].includes(form.interval_hours)
                    ? String(form.interval_hours)
                    : "custom"
                }
                onChange={(e) => {
                  if (e.target.value === "custom") field("interval_hours", 48);
                  else field("interval_hours", Number(e.target.value));
                }}
              >
                <option value="24">Every day</option>
                <option value="168">Every week</option>
                <option value="custom">Custom interval</option>
              </select>
            </label>
            <label className="field-label">
              Interval in hours
              <input
                required
                type="number"
                min={1}
                max={8760}
                value={form.interval_hours}
                onChange={(e) =>
                  field("interval_hours", Number(e.target.value))
                }
              />
            </label>
            <label className="field-label">
              Maximum scheduled runs per day
              <input
                required
                type="number"
                min={1}
                max={24}
                value={form.scheduled_runs_per_day ?? 1}
                onChange={(e) =>
                  field("scheduled_runs_per_day", Number(e.target.value))
                }
              />
            </label>
            <label className="field-label">
              Hold new discovery runs at this audit backlog
              <input
                required
                type="number"
                min={1}
                max={50}
                value={form.max_audit_backlog ?? 5}
                onChange={(e) =>
                  field("max_audit_backlog", Number(e.target.value))
                }
              />
            </label>
          </div>
          <p className="automation-control-help">
            Counts include queued and running audits. New discovery runs wait at
            the threshold; an active run may finish its batch. Provider request
            caps still apply. Scheduled-run limits use the UTC accounting day.
          </p>
          <label className="switch-row">
            <span>
              <strong>Enable scheduled discovery</strong>
              <small>Requires the background worker to be running.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={form.enabled}
              onChange={(e) => field("enabled", e.target.checked)}
            />
          </label>
          {(
            [
              [
                "browser",
                "Mobile browser diagnostics",
                "Read-only screenshots, rendered image dimensions, and layout overflow.",
              ],
              [
                "history",
                "Historical snapshot lookup",
                "Retrieve archive availability. Visual comparison is not included.",
              ],
              [
                "ai",
                "AI recommendations",
                "Analyze observed findings with OpenAI; grounded evidence is required.",
              ],
            ] as const
          ).map(([key, title, description]) => (
            <label className="switch-row" key={key}>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={form.modules[key]}
                onChange={(e) =>
                  field("modules", { ...form.modules, [key]: e.target.checked })
                }
              />
            </label>
          ))}
          {form.modules.history && (
            <label className="field-label">
              Historical reference period
              <select
                value={form.history_months}
                onChange={(e) =>
                  field("history_months", Number(e.target.value))
                }
              >
                {[12, 24, 36, 60].map((n) => (
                  <option key={n} value={n}>
                    {n === 60 ? "5 years" : `${n} months`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
        <section className="panel form-panel">
          <div className="section-heading">
            <span className="section-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <h2>Data retention</h2>
              <p>Keep research current and limit stored public contact data.</p>
            </div>
          </div>
          <label className="field-label">
            Remove research not refreshed within
            <select
              value={form.retention_days ?? 365}
              onChange={(e) => field("retention_days", Number(e.target.value))}
            >
              {[30, 90, 180, 365, 730].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <div className="inline-note">
            The worker permanently removes expired research, contacts,
            screenshots, and reports in bounded hourly batches. Suppression
            records are retained to respect opt-outs.
          </div>
        </section>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <span>
            {saved ? (
              <>
                <Check size={16} />{" "}
                {demo ? "Preview settings saved locally" : "Settings saved"}
              </>
            ) : demo ? (
              "Demo settings stay in this browser."
            ) : (
              "Changes apply to future discovery runs."
            )}
          </span>
          <Button type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : saved ? (
              <Check size={16} />
            ) : (
              <Save size={16} />
            )}
            Save configuration
          </Button>
        </div>
      </form>
      <aside className="settings-aside">
        <section className="panel provider-panel">
          <span className="section-icon">
            <PlugZap size={20} />
          </span>
          <h2>
            {settingsPage ? "Connected services" : "Your research toolkit"}
          </h2>
          <p>Provider credentials are stored on the server.</p>
          {[
            ["storeleads", "Store Leads", "Store discovery"],
            ["brave", "Brave Search", "Alternative discovery"],
            ["tavily", "Tavily Search", "Store discovery"],
            ["pagespeed", "PageSpeed Insights", "Technical screening"],
            ["openai", "OpenAI", "Evidence-based analysis"],
          ].map(([key, label, description]) => (
            <div className="integration-row" key={key}>
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <span
                className={`status-dot ${integrations[key] && !demo ? "green" : "gray"}`}
                title={
                  integrations[key] && !demo ? "Configured" : "Not connected"
                }
              />
            </div>
          ))}
          <div className="inline-note">
            {demo
              ? "Preview mode · no live integrations are used."
              : "Configure credentials in your server environment. API plan access may be required."}
          </div>
          <a
            className="text-button"
            href={
              form.provider === "tavily"
                ? "https://docs.tavily.com/documentation/api-reference/endpoint/search"
                : form.provider === "brave"
                  ? "https://api-dashboard.search.brave.com/documentation"
                  : "https://storeleads.app/api"
            }
            target="_blank"
            rel="noreferrer"
          >
            Provider documentation <ExternalLink size={14} />
          </a>
        </section>
        <section className="research-note">
          <ShieldCheck size={24} />
          <h3>
            Research on autopilot.
            <br />
            Outreach in your hands.
          </h3>
          <p>
            Every prospect is checked against country, platform, service fit,
            permission, and suppression rules.
          </p>
          <p>Nothing is sent to a merchant from Scout.</p>
        </section>
        <Button variant="outline" onClick={onRun}>
          Run saved configuration <ArrowRight size={16} />
        </Button>
      </aside>
    </div>
  );
}
