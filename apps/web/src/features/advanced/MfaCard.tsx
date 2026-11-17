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
      className="p-4 sm:p-5 rounded-xl bg-success-soft border border-success-border text-xs sm:text-sm text-success-text space-y-3"
      role="status"
    >
      <div>
        <b className="font-bold text-sm block mb-1">Save these recovery codes now.</b>
        <p className="text-xs text-success-text m-0">
          Each code works once if you ever lose your authenticator device. They will not be shown again.
        </p>
      </div>

      <pre className="p-3 bg-surface rounded-lg border border-success-border font-mono text-xs sm:text-sm font-bold tracking-wider leading-relaxed overflow-x-auto text-text-main">
        {text}
      </pre>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-success-border bg-surface text-success-text hover:bg-success-soft transition-colors cursor-pointer"
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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-success-border bg-surface text-success-text hover:bg-success-soft transition-colors cursor-pointer"
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
          className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-success hover:opacity-90 transition-opacity cursor-pointer"
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
          <KeyRound size={17} className="text-accent" />
          Two-Step Verification (TOTP)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 space-y-4">
        {s?.workspace_requires_mfa && !s.enabled && (
          <div className="p-3.5 rounded-xl bg-warning-soft border border-warning-border text-warning-text text-xs font-semibold flex items-center gap-2">
            <ShieldAlert size={16} className="text-warning shrink-0" />
            <span>This workspace requires two-step verification. Set it up below to continue.</span>
          </div>
        )}

        <p className="text-xs text-text-muted m-0 leading-relaxed">
          {s?.enabled
            ? `Two-step verification is enabled. ${s.recovery_codes_remaining} recovery code${s.recovery_codes_remaining === 1 ? "" : "s"} remaining.`
            : "Protect your account by requiring an authenticator app (1Password, Google Authenticator, Authy, Apple Keychain) on login."}
        </p>

        {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}

        {!s?.enabled && !setup && !codes && (
          <button
            className="px-4 py-2.5 rounded-lg text-xs sm:text-sm font-semibold text-on-accent bg-accent hover:bg-accent-strong active:opacity-90 transition-colors cursor-pointer disabled:opacity-60"
            disabled={enroll.isPending}
            onClick={() => enroll.mutate()}
          >
            {enroll.isPending ? "Setting up…" : "Set up authenticator app"}
          </button>
        )}

        {setup && (
          <div className="p-4 sm:p-5 rounded-xl border border-border bg-surface-2 space-y-4">
            <p className="text-xs sm:text-sm font-semibold text-text-main m-0">
              Scan this QR code with your authenticator app, or copy the secret key:
            </p>

            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
              <div className="p-2 bg-white rounded-xl shadow-xs border border-border shrink-0">
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
                  <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted block mb-1">
                    Secret Key
                  </span>
                  <code className="px-2.5 py-1.5 rounded-lg bg-surface border border-border font-mono text-xs font-bold text-text-main block break-all">
                    {setup.secret}
                  </code>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1">
                    6-digit code from app
                  </label>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    placeholder="123456"
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className="w-full sm:w-48 px-3.5 py-2 rounded-lg border border-border bg-surface text-text-main font-mono text-base font-bold tracking-widest text-center focus:outline-hidden"
                  />
                </div>

                {msg && (
                  <div className="p-2.5 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs">
                    {msg}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    className="px-4 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-strong transition-colors cursor-pointer disabled:opacity-50"
                    disabled={code.length !== 6 || confirm.isPending}
                    onClick={() => confirm.mutate()}
                  >
                    {confirm.isPending ? "Verifying…" : "Turn on"}
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg text-xs font-semibold border border-border bg-surface-2 text-text-main hover:bg-surface-3 transition-colors cursor-pointer"
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
                className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-border bg-surface-2 text-text-main hover:bg-surface-3 transition-colors cursor-pointer"
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
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-danger-border bg-danger-soft text-danger-text hover:bg-danger/20 transition-colors cursor-pointer"
                  onClick={() => setOff({ ...off, open: !off.open })}
                >
                  Turn off
                </button>
              )}
            </div>

            {off.open && (
              <div className="p-4 rounded-xl border border-danger-border bg-danger-soft space-y-3 max-w-md">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={off.password}
                    onChange={(e) => setOff({ ...off, password: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-main text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1">
                    Authenticator or recovery code
                  </label>
                  <input
                    value={off.code}
                    onChange={(e) => setOff({ ...off, code: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-main text-xs font-mono font-bold"
                  />
                </div>
                {msg && (
                  <div className="p-2 rounded bg-danger-soft border border-danger-border text-danger-text text-xs">
                    {msg}
                  </div>
                )}
                <button
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-danger hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
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
          <div className="pt-3 border-t border-border">
            <label className="flex items-center gap-2.5 text-xs sm:text-sm font-medium text-text-main cursor-pointer">
              <input
                type="checkbox"
                checked={policy.data.require_mfa}
                disabled={setPolicy.isPending || (!s?.enabled && !policy.data.require_mfa)}
                onChange={(e) => setPolicy.mutate(e.target.checked)}
                className="w-4 h-4 rounded accent-accent text-accent focus:ring-accent border-border"
              />
              <span>Require two-step verification for all members in this workspace</span>
              <span className="text-text-muted text-xs">
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
