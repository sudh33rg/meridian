import { formatTime, formatDateTime } from "../../lib/datetime";
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Webhook, Plus } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

type Hook = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  events: string[];
  consecutive_failures: number;
  disabled_reason: string | null;
  last_success_at: string | null;
};
type Delivery = {
  id: string;
  event_type: string;
  state: "pending" | "sending" | "delivered" | "dead";
  attempts: number;
  last_status: number | null;
  last_error: string | null;
  created_at: string;
};

function Deliveries({ hookId }: { hookId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["deliveries", hookId],
    queryFn: () => api<Delivery[]>(`/admin/webhooks/${hookId}/deliveries`),
    refetchInterval: 3000,
  });
  const again = useMutation({
    mutationFn: (id: string) => send<void>(`/admin/webhook-deliveries/${id}/redeliver`, "", "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deliveries", hookId] }),
  });
  return (
    <div className="overflow-x-auto border border-border rounded-xl mt-3 bg-bg">
      <table className="panel-table w-full text-left text-xs">
        <thead className="bg-surface-2 border-b border-border text-text-subtle font-semibold uppercase text-[10px]">
          <tr>
            <th className="p-2.5">Event</th>
            <th className="p-2.5">Result</th>
            <th className="p-2.5">Attempts</th>
            <th className="p-2.5">When</th>
            <th className="p-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {(q.data ?? []).map((d) => (
            <tr key={d.id} className="hover:bg-surface-2 transition-colors">
              <td className="p-2.5 font-mono text-text-main">{d.event_type}</td>
              <td className="p-2.5">
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded inline-block ${
                    d.state === "delivered"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-rose-500/10 text-rose-600"
                  }`}
                >
                  {d.state}
                </span>{" "}
                <span className="font-mono text-text-main font-semibold">{d.last_status ?? ""}</span>{" "}
                <span className="text-text-subtle text-[11px]">{d.last_error ?? ""}</span>
              </td>
              <td className="p-2.5 font-mono">{d.attempts}</td>
              <td className="p-2.5 font-mono text-text-subtle">{formatTime(d.created_at)}</td>
              <td className="p-2.5 text-right">
                <button
                  className="px-2 py-0.5 bg-surface hover:bg-surface-3 border border-border rounded text-[11px] font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
                  onClick={() => again.mutate(d.id)}
                >
                  Redeliver
                </button>
              </td>
            </tr>
          ))}
          {!(q.data ?? []).length && (
            <tr>
              <td colSpan={5} className="p-3 text-center text-xs text-text-subtle">
                No deliveries yet. Use "Send test event".
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function WebhooksPanel() {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", url: "", events: "" });
  const [secret, setSecret] = useState<{ id?: string; secret: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const hooks = useQuery({ queryKey: ["webhooks"], queryFn: () => api<Hook[]>("/admin/webhooks") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["webhooks"] });
  const fail = (e: unknown) => setError(errorMessage(e));
  const create = useMutation({
    mutationFn: () =>
      send<{ id: string; secret: string }>("/admin/webhooks", "", "POST", {
        name: form.name,
        url: form.url,
        events: form.events
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
      }),
    onSuccess: (r) => {
      setSecret(r);
      setForm({ name: "", url: "", events: "" });
      setError("");
      refresh();
    },
    onError: fail,
  });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string; enabled?: boolean }) =>
      send<void>(`/admin/webhooks/${id}`, "", "PATCH", body),
    onSuccess: refresh,
    onError: fail,
  });
  const del = useMutation({
    mutationFn: (id: string) => send<void>(`/admin/webhooks/${id}`, "", "DELETE"),
    onSuccess: refresh,
    onError: fail,
  });
  const rotate = useMutation({
    mutationFn: (id: string) => send<{ secret: string }>(`/admin/webhooks/${id}/rotate-secret`, "", "POST"),
    onSuccess: (r) => setSecret(r),
    onError: fail,
  });
  const test = useMutation({
    mutationFn: (id: string) => send<void>(`/admin/webhooks/${id}/test`, "", "POST"),
    onSuccess: (_r, id) => {
      setOpen(id);
      qc.invalidateQueries({ queryKey: ["deliveries", id] });
    },
    onError: fail,
  });

  return (
    <div className="ext-wrap space-y-6">
      <PageHeader
        title="Webhooks"
        subtitle="Deliver signed real-time HTTPS webhooks when issues, projects, or knowledge documents change."
      />

      {error && (
        <div
          className="p-3.5 rounded-xl bg-danger/10 border border-danger/20 text-danger text-xs sm:text-sm py-[11px] px-[13px] my-3"
          role="alert"
        >
          {error}
        </div>
      )}

      {secret && (
        <div
          className="ok p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 space-y-2 text-xs sm:text-sm"
          role="status"
        >
          <b>Signing secret — copy it now; it is shown once.</b>
          <pre className="p-3 bg-bg border border-border rounded-lg font-mono text-xs overflow-x-auto text-text-main">
            {secret.secret}
          </pre>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Verify requests with the <code>webhook-signature</code> header (HMAC-SHA256 of{" "}
              <code>id.timestamp.body</code>).
            </span>
            <button
              className="px-3 py-1 bg-surface border border-border rounded-lg text-xs inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:bg-surface-3 hover:text-text-main"
              onClick={() => setSecret(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Existing Webhooks List */}
      <Card className="panel-card space-y-4">
        <CardHeader className="pb-2 border-b border-border">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle flex items-center gap-2">
            <Webhook size={16} /> Webhook endpoints
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <p className="text-xs sm:text-sm text-text-subtle">
            Meridian POSTs signed JSON to your public HTTPS URL when things change. Private and internal
            addresses are refused. Failed deliveries are retried with backoff.
          </p>
          <div className="space-y-3">
            {(hooks.data ?? []).map((h) => (
              <div key={h.id} className="p-4 rounded-xl border border-border bg-surface-2 space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <b className="text-text-main text-sm font-semibold">{h.name}</b>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-block ${
                          h.enabled
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-surface text-text-subtle border border-border"
                        }`}
                      >
                        {h.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <div className="text-xs text-text-subtle font-mono">
                      {h.url} · {h.events.length ? h.events.join(", ") : "all events"}
                      {h.last_success_at ? ` · last success ${formatDateTime(h.last_success_at)}` : ""}
                    </div>
                    {h.disabled_reason && (
                      <div className="text-xs text-danger font-medium mt-1 bg-danger-soft border border-danger-border rounded-lg py-[11px] px-[13px] my-3">
                        {h.disabled_reason}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      className="px-2.5 py-1 bg-surface hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main"
                      onClick={() => test.mutate(h.id)}
                    >
                      Send test
                    </button>
                    <button
                      className="px-2.5 py-1 bg-surface hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main"
                      onClick={() => setOpen(open === h.id ? null : h.id)}
                    >
                      {open === h.id ? "Hide log" : "Delivery log"}
                    </button>
                    <button
                      className="px-2.5 py-1 bg-surface hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main"
                      onClick={() => patch.mutate({ id: h.id, enabled: !h.enabled })}
                    >
                      {h.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="px-2.5 py-1 bg-surface hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main"
                      onClick={() => rotate.mutate(h.id)}
                    >
                      Rotate secret
                    </button>
                    <button
                      className="px-2.5 py-1 bg-surface hover:bg-danger/10 hover:text-danger border border-border rounded-lg text-xs font-medium transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted"
                      onClick={() => del.mutate(h.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {open === h.id && <Deliveries hookId={h.id} />}
              </div>
            ))}
            {!(hooks.data ?? []).length && (
              <p className="text-xs text-text-subtle p-6 text-center">No endpoints yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add Endpoint Form */}
      <Card className="panel-card space-y-4">
        <CardHeader className="pb-2 border-b border-border">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle flex items-center gap-2">
            <Plus size={16} /> Add an endpoint
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>Name</span>
            <input
              value={form.name}
              placeholder="e.g. CI / Slack Notifier"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>URL (https)</span>
            <input
              value={form.url}
              placeholder="https://example.com/hooks/meridian"
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>
              Events{" "}
              <span className="text-text-subtle font-normal text-xs">
                (comma separated, e.g. issue.created, page.*; empty = all)
              </span>
            </span>
            <input
              value={form.events}
              placeholder="issue.*, sprint.*"
              onChange={(e) => setForm({ ...form, events: e.target.value })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <div className="pt-2">
            <button
              className="px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs sm:text-sm font-medium transition-colors disabled:opacity-50 shadow-sm inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)]"
              disabled={!form.name || !form.url || create.isPending}
              onClick={() => create.mutate()}
            >
              Add endpoint
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
