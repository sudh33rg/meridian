import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { KeyRound, ShieldAlert, Copy, Download, Check } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

type MfaStatus = {
  enabled: boolean;
  pending_enrolment: boolean;
  recovery_codes_remaining: number;
  workspace_requires_mfa: boolean;
};

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join("\n");
  const [copied, setCopied] = useState(false);

  return (
    <div
      className="p-4 sm:p-5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs sm:text-sm text-emerald-900 dark:text-emerald-200 space-y-3"
      role="status"
    >
      <div>
        <b className="font-bold text-sm block mb-1">Save these recovery codes now.</b>
        <p className="text-xs text-emerald-800 dark:text-emerald-300 m-0">
          Each code works once if you ever lose your authenticator device. They will not be shown again.
        </p>
      </div>

      <pre className="p-3 bg-white/80 dark:bg-slate-900/80 rounded-lg border border-emerald-200/80 dark:border-emerald-800/80 font-mono text-xs sm:text-sm font-bold tracking-wider leading-relaxed overflow-x-auto text-slate-800 dark:text-slate-200">
        {text}
      </pre>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 transition-colors cursor-pointer"
          onClick={() => {
            navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy codes"}
        </button>

        <button
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 transition-colors cursor-pointer"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain" }));
            a.download = "meridian-recovery-codes.txt";
            a.click();
          }}
        >
          <Download size={14} /> Download
        </button>

        <button
          className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 transition-colors cursor-pointer"
          onClick={onDone}
        >
          I have saved them
        </button>
      </div>
    </div>
  );
}

export function MfaCard() {
  const { me, setError } = useWorkspace();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["mfa"], queryFn: () => api<MfaStatus>("/auth/mfa") });
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [off, setOff] = useState({ open: false, password: "", code: "" });
  const [msg, setMsg] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["mfa"] });

  const enroll = useMutation({
    mutationFn: () => send<{ secret: string; otpauth_uri: string }>("/auth/mfa/enroll", "", "POST"),
    onSuccess: async (r) =>
      setSetup({
        secret: r.secret,
        uri: r.otpauth_uri,
        qr: await QRCode.toDataURL(r.otpauth_uri, { width: 200, margin: 1 }),
      }),
    onError: (e) => setError(errorMessage(e)),
  });

  const confirm = useMutation({
    mutationFn: () => send<{ recovery_codes: string[] }>("/auth/mfa/confirm", "", "POST", { code }),
    onSuccess: (r) => {
      setCodes(r.recovery_codes);
      setSetup(null);
      setCode("");
      setMsg("");
      refresh();
    },
    onError: (e) => setMsg(errorMessage(e)),
  });

  const disable = useMutation({
    mutationFn: () => send<void>("/auth/mfa/disable", "", "POST", { password: off.password, code: off.code }),
    onSuccess: () => {
      setOff({ open: false, password: "", code: "" });
      setMsg("");
      refresh();
    },
    onError: (e) => setMsg(errorMessage(e)),
  });

  const regenerate = useMutation({
    mutationFn: (c: string) =>
      send<{ recovery_codes: string[] }>("/auth/mfa/recovery-codes", "", "POST", { code: c }),
    onSuccess: (r) => {
      setCodes(r.recovery_codes);
      refresh();
    },
    onError: (e) => setMsg(errorMessage(e)),
  });

  const policy = useQuery({
    queryKey: ["workspace-security"],
    queryFn: () => api<{ require_mfa: boolean; members_without_mfa: number }>("/workspace/security"),
    enabled: me?.role === "owner" || me?.role === "admin",
  });

  const setPolicy = useMutation({
    mutationFn: (v: boolean) => send<void>("/workspace/security", "", "PATCH", { require_mfa: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspace-security"] }),
    onError: (e) => setError(errorMessage(e)),
  });

  const s = status.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <KeyRound size={17} className="text-indigo-600 dark:text-indigo-400" />
          Two-Step Verification (TOTP)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 space-y-4">
        {s?.workspace_requires_mfa && !s.enabled && (
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 text-xs font-semibold flex items-center gap-2">
            <ShieldAlert size={16} className="text-amber-600 shrink-0" />
            <span>This workspace requires two-step verification. Set it up below to continue.</span>
          </div>
        )}

        <p className="text-xs text-slate-500 m-0 leading-relaxed">
          {s?.enabled
            ? `Two-step verification is enabled. ${s.recovery_codes_remaining} recovery code${s.recovery_codes_remaining === 1 ? "" : "s"} remaining.`
            : "Protect your account by requiring an authenticator app (1Password, Google Authenticator, Authy, Apple Keychain) on login."}
        </p>

        {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}

        {!s?.enabled && !setup && !codes && (
          <button
            className="px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors cursor-pointer disabled:opacity-60"
            disabled={enroll.isPending}
            onClick={() => enroll.mutate()}
          >
            {enroll.isPending ? "Setting up…" : "Set up authenticator app"}
          </button>
        )}

        {setup && (
          <div className="p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 space-y-4">
            <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 m-0">
              Scan this QR code with your authenticator app, or copy the secret key:
            </p>

            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
              <div className="p-2 bg-white rounded-xl shadow-xs border border-slate-200 shrink-0">
                <img
                  src={setup.qr}
                  alt="Authenticator QR code"
                  width={180}
                  height={180}
                  className="rounded"
                />
              </div>

              <div className="space-y-3 flex-1 min-w-0 w-full">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                    Secret Key
                  </span>
                  <code className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs font-bold text-slate-800 dark:text-slate-200 block break-all">
                    {setup.secret}
                  </code>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    6-digit code from app
                  </label>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    placeholder="123456"
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className="w-full sm:w-48 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-base font-bold tracking-widest text-center focus:outline-hidden"
                  />
                </div>

                {msg && (
                  <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 text-xs">
                    {msg}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50"
                    disabled={code.length !== 6 || confirm.isPending}
                    onClick={() => confirm.mutate()}
                  >
                    {confirm.isPending ? "Verifying…" : "Turn on"}
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setSetup(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {s?.enabled && !codes && (
          <div className="space-y-4 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => {
                  const c = window.prompt(
                    "Enter a current authenticator code to generate new recovery codes",
                  );
                  if (c) regenerate.mutate(c);
                }}
              >
                Generate new recovery codes
              </button>
              {!s.workspace_requires_mfa && (
                <button
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 transition-colors cursor-pointer"
                  onClick={() => setOff({ ...off, open: !off.open })}
                >
                  Turn off
                </button>
              )}
            </div>

            {off.open && (
              <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/20 space-y-3 max-w-md">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={off.password}
                    onChange={(e) => setOff({ ...off, password: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    Authenticator or recovery code
                  </label>
                  <input
                    value={off.code}
                    onChange={(e) => setOff({ ...off, code: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono font-bold"
                  />
                </div>
                {msg && (
                  <div className="p-2 rounded bg-rose-100 dark:bg-rose-900/40 text-rose-800 text-xs">
                    {msg}
                  </div>
                )}
                <button
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors cursor-pointer disabled:opacity-50"
                  disabled={!off.password || !off.code || disable.isPending}
                  onClick={() => disable.mutate()}
                >
                  Turn off two-step verification
                </button>
              </div>
            )}
          </div>
        )}

        {policy.data && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <label className="flex items-center gap-2.5 text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={policy.data.require_mfa}
                disabled={setPolicy.isPending || (!s?.enabled && !policy.data.require_mfa)}
                onChange={(e) => setPolicy.mutate(e.target.checked)}
                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700"
              />
              <span>Require two-step verification for all members in this workspace</span>
              <span className="text-slate-400 text-xs">
                ({policy.data.members_without_mfa} member{policy.data.members_without_mfa === 1 ? "" : "s"}{" "}
                without it)
              </span>
            </label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
