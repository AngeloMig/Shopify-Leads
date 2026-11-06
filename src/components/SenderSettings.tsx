import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { emptySender, portfolioLabel, type Sender } from "../../shared/sender";
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
  const changed =
    !!saved &&
    (Object.keys(draft) as (keyof Sender)[]).some((k) => draft[k] !== saved[k]);
  const set = (key: keyof Sender) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const url = draft.portfolio_url.trim();
      await saveSender(demo, {
        ...draft,
        // "grantwebsite.com" is taken to mean https://grantwebsite.com.
        portfolio_url:
          url && !/^https?:\/\//i.test(url) ? `https://${url}` : url,
      });
      notify("Saved. Your scripts now use these details.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const field = (
    key: keyof Sender,
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
