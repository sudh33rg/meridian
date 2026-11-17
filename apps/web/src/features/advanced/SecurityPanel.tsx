import { formatDateTime } from "../../lib/datetime";
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone, ShieldCheck, KeyRound, Check, Laptop } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { MfaCard } from "./MfaCard";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

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

const when = (s: string) => formatDateTime(s);

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
    <Card>
      <CardHeader>
        <CardTitle>
          <KeyRound size={17} className="text-accent" />
          Change Password
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 space-y-4">
        <p className="text-xs text-text-muted m-0">
          Changing your password immediately signs out all other active browsers and mobile sessions.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setState({ kind: "idle" });
            change.mutate();
          }}
          className="space-y-4 max-w-md"
        >
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
              Current password
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={form.current_password}
              onChange={(e) => setForm({ ...form, current_password: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
              New password
            </label>
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              placeholder="At least 12 characters"
              value={form.new_password}
              onChange={(e) => setForm({ ...form, new_password: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm"
            />
          </div>

          {state.kind === "error" && (
            <div className="p-3 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs font-medium py-[11px] px-[13px] my-3">
              {state.text}
            </div>
          )}

          {state.kind === "ok" && (
            <div className="ok p-3 rounded-lg bg-success-soft border border-success-border text-success-text text-xs font-medium">
              {state.text}
            </div>
          )}

          <button
            type="submit"
            className="px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-strong active:opacity-90 transition-colors cursor-pointer disabled:opacity-60"
            disabled={change.isPending}
          >
            {change.isPending ? "Please wait…" : "Change password"}
          </button>
        </form>
      </CardContent>
    </Card>
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
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-text-main m-0">Security & Access</h2>
        <p className="text-xs sm:text-sm text-text-muted mt-1 m-0">
          Manage your credentials, two-factor authentication, and monitor connected devices.
        </p>
      </div>

      {/* Account Security Header Card */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
              <ShieldCheck size={22} />
            </div>
            <div>
              <div className="text-xs sm:text-sm font-bold text-text-main">Account Credentials</div>
              <div className="text-xs text-text-muted mt-0.5">
                Signed in as <b className="text-text-main">{me?.email}</b>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {me?.email_verified ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-success-soft text-success-text border border-success-border">
                <Check size={13} /> Email verified
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-warning-soft text-warning-text border border-warning-border">
                  Email not verified
                </span>
                <button
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-surface-2 hover:bg-surface-3 text-text-main transition-colors cursor-pointer"
                  disabled={verificationSent}
                  onClick={resendVerification}
                >
                  {verificationSent ? "Email sent" : "Resend confirmation"}
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <MfaCard />

      <ChangePassword onChanged={() => qc.invalidateQueries({ queryKey: ["sessions"] })} />

      {/* Active Sign-ins Card */}
      <Card>
        <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle>
              <MonitorSmartphone size={17} className="text-accent" />
              Active Sign-ins
            </CardTitle>
            <p className="text-xs text-text-muted m-0 mt-0.5">
              Browsers and devices currently authenticated into this workspace with your account.
            </p>
          </div>
          <button
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-danger-border bg-danger-soft text-danger-text hover:bg-danger/20 transition-colors cursor-pointer disabled:opacity-50 self-start sm:self-auto"
            disabled={rows.length < 2 || revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            Sign out all other devices
          </button>
        </CardHeader>
        <div className="overflow-x-auto">
          {sessions.isLoading ? (
            <div className="p-6 text-xs text-text-muted text-center">Loading sessions…</div>
          ) : (
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-surface-2 text-text-muted text-[11px] font-bold uppercase tracking-wider border-b border-border">
                <tr>
                  <th className="px-4 py-3">Device & Browser</th>
                  <th className="px-4 py-3">Signed In</th>
                  <th className="px-4 py-3">Last Active</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3 font-medium text-text-main flex items-center gap-2">
                      <Laptop size={15} className="text-text-muted shrink-0" />
                      <span>{device(s.user_agent)}</span>
                      {s.current && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent-soft text-accent">
                          This device
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-muted">{when(s.created_at)}</td>
                    <td className="px-4 py-3 text-text-muted">{when(s.last_seen_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {!s.current && (
                        <button
                          className="px-2.5 py-1 rounded text-xs font-semibold text-danger-text hover:bg-danger-soft transition-colors cursor-pointer"
                          onClick={() => revoke.mutate(s.id)}
                        >
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
      </Card>
    </div>
  );
}
