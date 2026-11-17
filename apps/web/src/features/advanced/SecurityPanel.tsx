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
          <KeyRound size={17} className="text-indigo-600 dark:text-indigo-400" />
          Change Password
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 space-y-4">
        <p className="text-xs text-slate-500 m-0">
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
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Current password
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={form.current_password}
              onChange={(e) => setForm({ ...form, current_password: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
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
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm"
            />
          </div>

          {state.kind === "error" && (
            <div className="error p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">
              {state.text}
            </div>
          )}

          {state.kind === "ok" && (
            <div className="ok p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 text-xs font-medium">
              {state.text}
            </div>
          )}

          <button
            type="submit"
            className="px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors cursor-pointer disabled:opacity-60"
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
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white m-0">
          Security & Access
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 m-0">
          Manage your credentials, two-factor authentication, and monitor connected devices.
        </p>
      </div>

      {/* Account Security Header Card */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <ShieldCheck size={22} />
            </div>
            <div>
              <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                Account Credentials
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Signed in as <b className="text-slate-800 dark:text-slate-200">{me?.email}</b>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {me?.email_verified ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <Check size={13} /> Email verified
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  Email not verified
                </span>
                <button
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
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
              <MonitorSmartphone size={17} className="text-indigo-600 dark:text-indigo-400" />
              Active Sign-ins
            </CardTitle>
            <p className="text-xs text-slate-500 m-0 mt-0.5">
              Browsers and devices currently authenticated into this workspace with your account.
            </p>
          </div>
          <button
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-50 self-start sm:self-auto"
            disabled={rows.length < 2 || revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            Sign out all other devices
          </button>
        </CardHeader>
        <div className="overflow-x-auto">
          {sessions.isLoading ? (
            <div className="p-6 text-xs text-slate-400 text-center">Loading sessions…</div>
          ) : (
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Device & Browser</th>
                  <th className="px-4 py-3">Signed In</th>
                  <th className="px-4 py-3">Last Active</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white flex items-center gap-2">
                      <Laptop size={15} className="text-slate-400 shrink-0" />
                      <span>{device(s.user_agent)}</span>
                      {s.current && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                          This device
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{when(s.created_at)}</td>
                    <td className="px-4 py-3 text-slate-500">{when(s.last_seen_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {!s.current && (
                        <button
                          className="px-2.5 py-1 rounded text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
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
