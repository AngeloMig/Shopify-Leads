import { useState } from "react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { api } from "../lib";
import { importDomains } from "../../shared/domain-import";
type Row = { input: string; domain: string; status: string };
export function DomainImport({
  open,
  onClose,
  queries,
  live,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  queries: { id?: string; name: string }[];
  live: boolean;
  onDone: () => void;
}) {
  const [text, setText] = useState(""),
    [query, setQuery] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const queryId = query || queries[0]?.id;
  async function preview() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      if (!live)
        throw new Error("Imports are available in your live workspace.");
      if (!queryId) throw new Error("Save a discovery campaign first.");
      const r = await api<{ rows: Row[] }>("/imports/preview", {
        domains: importDomains(text),
        query_id: queryId,
      });
      setRows(r.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function queue() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ queued: number; rows: Row[] }>("/imports", {
        domains: importDomains(text),
        query_id: queryId,
      });
      setResult(
        `${r.queued} audits queued. Track progress in Automation jobs.`,
      );
      setRows([]);
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
        if (!v) onClose();
      }}
      title="Import known stores"
      description="Audit stores you already know without a discovery search."
    >
      <div className="import-form">
        <label className="field-label">
          Audit campaign
          <select
            disabled={busy}
            value={queryId ?? ""}
            onChange={(e) => {
              setQuery(e.target.value);
              setRows([]);
            }}
          >
            {queries.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Domains or CSV
          <textarea
            disabled={busy}
            rows={6}
            value={text}
            placeholder={"store.com\nanother-store.com"}
            onChange={(e) => {
              setText(e.target.value);
              setRows([]);
              setResult("");
            }}
          />
        </label>
        <label className="field-label">
          Or choose a CSV file
          <input
            disabled={busy}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 1_000_000) {
                setError("Keep the import file under 1 MB.");
                return;
              }
              setBusy(true);
              try {
                setText(await f.text());
                setRows([]);
                setResult("");
                setError("");
              } catch {
                setError(
                  "This file could not be read. Choose it again or paste the domains.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <p className="muted">
          Up to 50 stores. Multi-column CSVs need a Domain, URL or Website
          header. Existing research, duplicates and suppressed domains are
          skipped.
        </p>
        <p className="inline-note">
          Preview uses no discovery credits. Queued audits may make up to 6
          PageSpeed requests per qualifying store, within your daily budgets.
          Shopify, activity and country checks still apply.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {result && <p role="status">{result}</p>}
        {rows.length > 0 && (
          <div className="import-preview">
            <table>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Preview result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.domain || r.input}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={busy || !text.trim()}
            onClick={() => void preview()}
          >
            {busy ? "Checking…" : "Preview import"}
          </Button>
          {rows.some((r) => r.status === "Ready") && (
            <Button disabled={busy} onClick={() => void queue()}>
              Queue {rows.filter((r) => r.status === "Ready").length} audits
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
