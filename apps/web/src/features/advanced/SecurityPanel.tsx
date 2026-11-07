import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone, ShieldCheck } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { MfaCard } from "./MfaCard";

type SessionRow = {
  id: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  current: boolean;
};

const device = (ua: string) => {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  // iOS user agents also say "like Mac OS X", so test the mobile platforms first.
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
};
const when = (s: string) => new Date(s).toLocaleString();

function ChangePassword({ onChanged }: { onChanged: () => void }) {
  const [form, setForm] = useState({ current_password: "", new_password: "" });
  const [state, setState] = useState<{ kind: "idle" | "ok" | "error"; text?: string }>({ kind: "idle" });
  const change = useMutation({
    mutationFn: () => send<void>("/auth/change-password", "", "POST", form),
    onSuccess: () => {
      setForm({ current_password: "", new_password: "" });
      setState({ kind: "ok", text: "Password changed. Every other device was signed out." });
      onChanged();
    },
    onError: (e) => setState({ kind: "error", text: errorMessage(e) }),
  });
  return (
    <div className="panel-card">
      <h3>Change password</h3>
      <p className="muted">Changing it signs out every other browser and device.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setState({ kind: "idle" });
          change.mutate();
        }}
      >
        <label>
          Current password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={form.current_password}
            onChange={(e) => setForm({ ...form, current_password: e.target.value })}
          />
        </label>
        <label>
          New password
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            placeholder="At least 12 characters"
            value={form.new_password}
            onChange={(e) => setForm({ ...form, new_password: e.target.value })}
          />
        </label>
        {state.kind === "error" && (
          <div className="error" style={{ marginTop: 12 }}>
            {state.text}
          </div>
        )}
        {state.kind === "ok" && (
          <div className="ok" style={{ marginTop: 12 }}>
            {state.text}
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <button className="primary" disabled={change.isPending}>
            {change.isPending ? "Please wait…" : "Change password"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function SecurityPanel() {
  const { session, me, resendVerification, verificationSent, setError } = useWorkspace();
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ["sessions", session.tenant_id],
    queryFn: () => api<SessionRow[]>("/sessions"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => send<void>(`/sessions/${id}`, "", "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
    onError: (e) => setError(errorMessage(e)),
  });
  const revokeOthers = useMutation({
    mutationFn: () => send<{ revoked: number }>("/sessions/revoke-others", "", "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
    onError: (e) => setError(errorMessage(e)),
  });
  const rows = sessions.data ?? [];
  return (
    <div className="ext-wrap">
      <div className="panel-card">
        <h3>
          <ShieldCheck size={18} /> Account security
        </h3>
        <p className="muted">
          {me?.email ? (
            <>
              Signed in as <b>{me.email}</b>.{" "}
            </>
          ) : null}
          {me?.email_verified ? (
            <span className="tag">Email verified</span>
          ) : (
            <>
              <span className="tag">Email not verified</span>{" "}
              <button className="secondary" disabled={verificationSent} onClick={resendVerification}>
                {verificationSent ? "Email sent" : "Resend confirmation"}
              </button>
            </>
          )}
        </p>
      </div>
      <MfaCard />
      <ChangePassword onChanged={() => qc.invalidateQueries({ queryKey: ["sessions"] })} />
      <div className="panel-card">
        <div className="row-gap" style={{ justifyContent: "space-between" }}>
          <div>
            <h3>
              <MonitorSmartphone size={18} /> Active sign-ins
            </h3>
            <p className="muted">Browsers and devices signed in to this workspace as you.</p>
          </div>
          <button
            className="secondary"
            disabled={rows.length < 2 || revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            Sign out all other devices
          </button>
        </div>
        {sessions.isLoading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="panel-table">
            <thead>
              <tr>
                <th>Device</th>
                <th>Signed in</th>
                <th>Last active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    {device(s.user_agent)} {s.current && <span className="tag">This device</span>}
                  </td>
                  <td>{when(s.created_at)}</td>
                  <td>{when(s.last_seen_at)}</td>
                  <td style={{ textAlign: "right" }}>
                    {!s.current && (
                      <button className="secondary" onClick={() => revoke.mutate(s.id)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
