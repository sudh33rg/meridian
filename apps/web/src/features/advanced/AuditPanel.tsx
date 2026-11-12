import React, { useEffect, useState } from "react";
import { Activity, Download } from "lucide-react";
import { apiResponse } from "../../lib/api";
import type { AuditEvent } from "../../lib/types";
import { day, Empty, str } from "./shared";

/** Filters as the user types them. They apply only when "Apply" is pressed. */
type Filters = { action: string; entity_type: string; actor_id: string; from: string; to: string };

const EMPTY: Filters = { action: "", entity_type: "", actor_id: "", from: "", to: "" };
const PAGE = 50;

function queryString(f: Filters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.action.trim()) p.set("action", f.action.trim());
  if (f.entity_type.trim()) p.set("entity_type", f.entity_type.trim());
  if (f.actor_id.trim()) p.set("actor_id", f.actor_id.trim());
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

/** Reads one page and the cursor for the next one. Errors carry the API's own message. */
async function readPage(token: string, qs: string): Promise<{ rows: AuditEvent[]; next: string | null }> {
  const res = await apiResponse(`/audit/events?${qs}`, token);
  const text = await res.text();
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = JSON.parse(text) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status message when the body is not JSON.
    }
    throw new Error(message);
  }
  return { rows: JSON.parse(text) as AuditEvent[], next: res.headers.get("x-next-cursor") };
}

export function AuditPanel({ token, onError }: { token: string; onError: (message: string) => void }) {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState("");

  // First page, newest events, with no filters. Its own error state keeps the effect free of props.
  useEffect(() => {
    let cancelled = false;
    readPage(token, queryString(EMPTY, { limit: String(PAGE) }))
      .then((page) => {
        if (cancelled) return;
        setRows(page.rows);
        setNext(page.next);
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const run = async (filters: Filters, cursor?: string) => {
    setBusy(true);
    try {
      const page = await readPage(
        token,
        queryString(filters, { limit: String(PAGE), ...(cursor ? { cursor } : {}) }),
      );
      setRows((old) => (cursor ? [...old, ...page.rows] : page.rows));
      setNext(page.next);
      setLoaded(true);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    setApplied(draft);
    void run(draft);
  };

  const clear = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    void run(EMPTY);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await apiResponse(`/audit/export.csv?${queryString(applied)}`, token);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-events.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const set = (key: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [key]: e.target.value });

  return (
    <div className="panel audit-panel">
      <form
        className="audit-filters"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label>
          <span className="muted small">Action</span>
          <input value={draft.action} onChange={set("action")} placeholder="issue_created" maxLength={80} />
        </label>
        <label>
          <span className="muted small">Entity type</span>
          <input value={draft.entity_type} onChange={set("entity_type")} placeholder="issue" maxLength={80} />
        </label>
        <label>
          <span className="muted small">Member ID</span>
          <input value={draft.actor_id} onChange={set("actor_id")} placeholder="Optional" />
        </label>
        <label>
          <span className="muted small">From</span>
          <input type="date" value={draft.from} onChange={set("from")} />
        </label>
        <label>
          <span className="muted small">To</span>
          <input type="date" value={draft.to} onChange={set("to")} />
        </label>
        <div className="audit-actions">
          <button type="submit" disabled={busy}>
            Apply
          </button>
          <button type="button" className="secondary" onClick={clear} disabled={busy}>
            Clear
          </button>
          <button type="button" className="secondary" onClick={exportCsv} disabled={exporting || !loaded}>
            <Download size={15} /> Export CSV
          </button>
        </div>
      </form>
      {rows.map((r) => (
        <div className="ext-line" key={r.id}>
          <Activity size={17} />
          <div>
            <b>
              {str(r.actor)} {str(r.action)} {str(r.entity_type)}
            </b>
            <small>
              {str(r.entity_id)} · {day(r.occurred_at)}
            </small>
          </div>
        </div>
      ))}
      {loadError && <p className="error">{loadError}</p>}
      {loaded && !rows.length && (
        <Empty title="No matching events" caption="Change the filters or clear them to see more." />
      )}
      {next && (
        <button type="button" className="secondary" onClick={() => void run(applied, next)} disabled={busy}>
          Load more
        </button>
      )}
    </div>
  );
}
