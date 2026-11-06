import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Plus, X } from "lucide-react";
import {
  emptySender,
  maxCaseStudies,
  portfolioLabel,
  type CaseStudy,
  type Sender,
} from "../../shared/sender";
import { industries } from "../../shared/types";
import { saveSender, useSender } from "../sender-store";
import { Button } from "./ui/button";
import "../sender-settings.css";

/** Who outreach comes from: filled into every email and call script. */
export function SenderSettings({
  demo,
  notify,
}: {
  demo: boolean;
  notify: (message: string) => void;
}) {
  const saved = useSender(demo);
  const [draft, setDraft] = useState<Sender>(emptySender),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);
  const changed = !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  type TextKey = Exclude<keyof Sender, "work">;
  const set = (key: TextKey) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setWork = (i: number, patch: Partial<CaseStudy>) =>
    setDraft((d) => ({
      ...d,
      work: d.work.map((w, j) => (j === i ? { ...w, ...patch } : w)),
    }));
  const https = (url: string) =>
    url && !/^https?:\/\//i.test(url) ? `https://${url}` : url;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // "grantwebsite.com" is taken to mean https://grantwebsite.com.
      await saveSender(demo, {
        ...draft,
        portfolio_url: https(draft.portfolio_url.trim()),
        work: draft.work
          .map((w) => ({
            ...w,
            title: w.title.trim(),
            url: https(w.url.trim()),
          }))
          .filter((w) => w.title && w.url),
      });
      notify("Saved. Your scripts now use these details.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = (
    key: TextKey,
    label: string,
    props: { placeholder: string; type?: string; autoComplete?: string },
  ) => (
    <label className="field-label">
      {label}
      <input
        value={draft[key]}
        onChange={(e) => set(key)(e.target.value)}
        disabled={!saved}
        {...props}
      />
    </label>
  );
  return (
    <form
      id="your-details"
      className="panel sender-settings"
      onSubmit={(e) => void submit(e)}
      aria-labelledby="sender-title"
    >
      <div className="sender-head">
        <h2 id="sender-title">Your details for outreach</h2>
        <p>
          Filled into every email and call script in place of [Your name] and
          the rest. Your portfolio link goes in as a line where they can see
          your work.
        </p>
      </div>
      <div className="sender-grid">
        {field("name", "Your name", {
          placeholder: "First and last name",
          autoComplete: "name",
        })}
        {field("company", "Company", {
          placeholder: "Your studio or business name",
          autoComplete: "organization",
        })}
        {field("portfolio_url", "Portfolio link", {
          placeholder: "https://your-portfolio.com",
          autoComplete: "url",
        })}
        {field("address", "Business address", {
          placeholder: "Needed in marketing emails in most countries",
          autoComplete: "street-address",
        })}
      </div>
      {draft.portfolio_url && (
        <p className="sender-preview">
          Emails will say: “You can see some of our recent work at{" "}
          {draft.portfolio_url}”. On calls: “sites we’ve built at{" "}
          {portfolioLabel(draft.portfolio_url)}”.
        </p>
      )}
      <fieldset className="sender-work" disabled={!saved}>
        <legend>Work to show</legend>
        <p>
          A project in the same industry as the store goes in the email in place
          of your portfolio link: “We recently worked on Oak & Ash, another home
          & furniture store”.
        </p>
        {draft.work.map((w, i) => (
          <div className="sender-work-row" key={i}>
            <input
              aria-label={`Project ${i + 1} name`}
              placeholder="Client or project name"
              value={w.title}
              onChange={(e) => setWork(i, { title: e.target.value })}
            />
            <input
              aria-label={`Project ${i + 1} link`}
              placeholder="https://the-site.com"
              value={w.url}
              onChange={(e) => setWork(i, { url: e.target.value })}
            />
            <select
              aria-label={`Project ${i + 1} industry`}
              value={w.industry}
              onChange={(e) => setWork(i, { industry: e.target.value })}
            >
              <option value="">Industry</option>
              {industries.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove project ${i + 1}`}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  work: d.work.filter((_, j) => j !== i),
                }))
              }
            >
              <X size={15} />
            </button>
          </div>
        ))}
        {draft.work.length < maxCaseStudies && (
          <button
            type="button"
            className="text-button sender-add"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                work: [...d.work, { title: "", url: "", industry: "" }],
              }))
            }
          >
            <Plus size={14} /> Add a project
          </button>
        )}
      </fieldset>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <div className="sender-foot">
        <Button type="submit" disabled={!changed || busy}>
          {busy && <LoaderCircle className="spin" size={16} />}
          {changed || !saved ? "Save details" : "Saved"}
        </Button>
      </div>
    </form>
  );
}
