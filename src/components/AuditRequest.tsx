import { useState } from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { api } from "../lib";

/** Audit one website someone asked about, e.g. a free-audit form request. */
export function AuditRequest({
  open,
  onClose,
  live,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  live: boolean;
  onDone: () => void;
}) {
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult("");
    try {
      if (!live) throw new Error("Audits run in your live workspace.");
      const r = await api<{ domain: string; already_queued: boolean }>(
        "/audits/request",
        { url },
      );
      setResult(
        r.already_queued
          ? `${r.domain} is already being audited. Track it in Automation jobs.`
          : `Audit queued for ${r.domain}. It shows on Free audits, with its PDF when it finishes.`,
      );
      setUrl("");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setError("");
          setResult("");
          onClose();
        }
      }}
      title="Audit a website"
      description="Run the full audit and PDF for one site, such as a free-audit request."
    >
      <form className="import-form" onSubmit={(e) => void submit(e)}>
        <label className="field-label">
          Website
          <input
            disabled={busy}
            value={url}
            inputMode="url"
            autoComplete="off"
            placeholder="store.com"
            onChange={(e) => {
              setUrl(e.target.value);
              setResult("");
            }}
          />
        </label>
        <p className="inline-note">
          Any website works, Shopify or not, and it's reported on whatever its
          scores. Uses up to 6 PageSpeed requests from your daily budget. The
          homepage of the domain is audited, so a path after the domain is
          ignored.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {result && <p role="status">{result}</p>}
        <div className="dialog-actions">
          <Button type="submit" disabled={busy || !url.trim()}>
            {busy ? "Queuing…" : "Run audit"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
