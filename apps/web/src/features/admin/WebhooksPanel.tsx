import { formatTime, formatDateTime } from "../../lib/datetime";
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Webhook } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";

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
    <table className="panel-table">
      <thead>
        <tr>
          <th>Event</th>
          <th>Result</th>
          <th>Attempts</th>
          <th>When</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {(q.data ?? []).map((d) => (
          <tr key={d.id}>
            <td>{d.event_type}</td>
            <td>
              <span className="tag">{d.state}</span> {d.last_status ?? ""}{" "}
              <span className="muted small">{d.last_error ?? ""}</span>
            </td>
            <td>{d.attempts}</td>
            <td>{formatTime(d.created_at)}</td>
            <td style={{ textAlign: "right" }}>
              <button className="secondary" onClick={() => again.mutate(d.id)}>
                Redeliver
              </button>
            </td>
          </tr>
        ))}
        {!(q.data ?? []).length && (
          <tr>
            <td colSpan={5} className="muted">
              No deliveries yet. Use "Send test event".
            </td>
          </tr>
        )}
      </tbody>
    </table>
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
    <div className="ext-wrap">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {secret && (
        <div className="ok" role="status">
          <b>Signing secret — copy it now; it is shown once.</b>
          <pre style={{ margin: "8px 0", wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
            {secret.secret}
          </pre>
          Verify requests with the <code>webhook-signature</code> header (HMAC-SHA256 of{" "}
          <code>id.timestamp.body</code>, Standard Webhooks).{" "}
          <button className="secondary" onClick={() => setSecret(null)}>
            Done
          </button>
        </div>
      )}
      <div className="panel-card">
        <h3>
          <Webhook size={18} /> Webhook endpoints
        </h3>
        <p className="muted">
          Meridian POSTs signed JSON to your public HTTPS URL when things change. Private and internal
          addresses are refused. Failed deliveries are retried with backoff.
        </p>
        {(hooks.data ?? []).map((h) => (
          <div key={h.id} className="panel-card" style={{ background: "#fafbfe" }}>
            <div className="row-gap" style={{ justifyContent: "space-between" }}>
              <div>
                <b>{h.name}</b> <span className="tag">{h.enabled ? "Enabled" : "Disabled"}</span>
                <div className="muted small">
                  {h.url} · {h.events.length ? h.events.join(", ") : "all events"}
                  {h.last_success_at ? ` · last success ${formatDateTime(h.last_success_at)}` : ""}
                </div>
                {h.disabled_reason && (
                  <div className="error small" style={{ marginTop: 6 }}>
                    {h.disabled_reason}
                  </div>
                )}
              </div>
              <span className="row-gap">
                <button className="secondary" onClick={() => test.mutate(h.id)}>
                  Send test event
                </button>
                <button className="secondary" onClick={() => setOpen(open === h.id ? null : h.id)}>
                  {open === h.id ? "Hide log" : "Delivery log"}
                </button>
                <button className="secondary" onClick={() => patch.mutate({ id: h.id, enabled: !h.enabled })}>
                  {h.enabled ? "Disable" : "Enable"}
                </button>
                <button className="secondary" onClick={() => rotate.mutate(h.id)}>
                  Rotate secret
                </button>
                <button className="secondary" onClick={() => del.mutate(h.id)}>
                  Delete
                </button>
              </span>
            </div>
            {open === h.id && <Deliveries hookId={h.id} />}
          </div>
        ))}
        {!(hooks.data ?? []).length && <p className="muted">No endpoints yet.</p>}
      </div>
      <div className="panel-card">
        <h3>Add an endpoint</h3>
        <label>
          Name
          <input
            value={form.name}
            placeholder="CI notifier"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          URL (https)
          <input
            value={form.url}
            placeholder="https://example.com/hooks/meridian"
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
        </label>
        <label>
          Events <span className="muted">(comma separated, e.g. issue.created, page.*; empty = all)</span>
          <input value={form.events} onChange={(e) => setForm({ ...form, events: e.target.value })} />
        </label>
        <div style={{ marginTop: 12 }}>
          <button
            className="primary"
            disabled={!form.name || !form.url || create.isPending}
            onClick={() => create.mutate()}
          >
            Add endpoint
          </button>
        </div>
      </div>
    </div>
  );
}
