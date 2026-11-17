import React, { useEffect, useState } from "react";
import { Activity, Download, Filter } from "lucide-react";
import { apiResponse } from "../../lib/api";
import type { AuditEvent } from "../../lib/types";
import { day, Empty, str } from "./shared";
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

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
    <div className="panel audit-panel space-y-6">
      <PageHeader
        title="Audit Log"
        subtitle="Immutable security audit trail of all workspace and project events."
        actions={
          <button
            type="button"
            className="secondary inline-flex items-center gap-1.5 px-3.5 py-2 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs sm:text-sm font-medium text-text-main transition-colors disabled:opacity-50"
            onClick={exportCsv}
            disabled={exporting || !loaded}
          >
            <Download size={15} /> Export CSV
          </button>
        }
      />

      {/* Filter Card */}
      <Card className="p-4 sm:p-5">
        <form
          className="audit-filters space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <div className="flex items-center gap-1.5 text-xs font-bold text-text-subtle uppercase tracking-wider pb-2 border-b border-border">
            <Filter size={14} /> Filter Events
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <label className="block space-y-1">
              <span className="muted small text-xs font-medium text-text-subtle">Action</span>
              <input
                value={draft.action}
                onChange={set("action")}
                placeholder="e.g. issue_created"
                maxLength={80}
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label className="block space-y-1">
              <span className="muted small text-xs font-medium text-text-subtle">Entity type</span>
              <input
                value={draft.entity_type}
                onChange={set("entity_type")}
                placeholder="e.g. issue"
                maxLength={80}
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label className="block space-y-1">
              <span className="muted small text-xs font-medium text-text-subtle">Member ID</span>
              <input
                value={draft.actor_id}
                onChange={set("actor_id")}
                placeholder="Optional"
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label className="block space-y-1">
              <span className="muted small text-xs font-medium text-text-subtle">From</span>
              <input
                type="date"
                value={draft.from}
                onChange={set("from")}
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label className="block space-y-1">
              <span className="muted small text-xs font-medium text-text-subtle">To</span>
              <input
                type="date"
                value={draft.to}
                onChange={set("to")}
                className="w-full px-3 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
          </div>
          <div className="audit-actions flex items-center gap-2 pt-2 border-t border-border">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-1.5 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs font-medium transition-colors shadow-sm disabled:opacity-50"
            >
              Apply
            </button>
            <button
              type="button"
              className="secondary px-3 py-1.5 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main transition-colors disabled:opacity-50"
              onClick={clear}
              disabled={busy}
            >
              Clear
            </button>
          </div>
        </form>
      </Card>

      {/* Events List */}
      <Card className="p-0 overflow-hidden">
        <CardHeader className="p-4 border-b border-border">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle">
            Events ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/60">
            {rows.map((r) => (
              <div
                className="ext-line flex items-center gap-3 p-3.5 hover:bg-surface-2 transition-colors"
                key={r.id}
              >
                <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center shrink-0 text-text-subtle">
                  <Activity size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <b className="text-xs sm:text-sm font-semibold text-text-main block truncate">
                    {str(r.actor)} {str(r.action)} {str(r.entity_type)}
                  </b>
                  <small className="text-xs text-text-subtle font-mono block">
                    {str(r.entity_id)} · {day(r.occurred_at)}
                  </small>
                </div>
              </div>
            ))}
          </div>
          {loadError && (
            <p className="error p-4 text-xs text-danger bg-danger/10 border-t border-danger/20 font-medium">
              {loadError}
            </p>
          )}
          {loaded && !rows.length && (
            <div className="p-12">
              <Empty title="No matching events" caption="Change the filters or clear them to see more." />
            </div>
          )}
          {next && (
            <div className="p-4 text-center border-t border-border">
              <button
                type="button"
                className="secondary px-4 py-2 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main transition-colors"
                onClick={() => void run(applied, next)}
                disabled={busy}
              >
                Load more
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
