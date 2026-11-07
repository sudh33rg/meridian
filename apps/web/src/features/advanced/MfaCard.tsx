import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { KeyRound } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";

type MfaStatus = {
  enabled: boolean;
  pending_enrolment: boolean;
  recovery_codes_remaining: number;
  workspace_requires_mfa: boolean;
};

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join("\n");
  return (
    <div className="ok" role="status">
      <b>Save these recovery codes now.</b> Each works once if you lose your device. They will not be shown
      again.
      <pre style={{ margin: "10px 0", fontSize: 15, lineHeight: 1.7 }}>{text}</pre>
      <div className="row-gap">
        <button className="secondary" onClick={() => navigator.clipboard?.writeText(text)}>
          Copy
        </button>
        <button
          className="secondary"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain" }));
            a.download = "meridian-recovery-codes.txt";
            a.click();
          }}
        >
          Download
        </button>
        <button className="primary" onClick={onDone}>
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
    <div className="panel-card">
      <h3>
        <KeyRound size={18} /> Two-step verification
      </h3>
      {s?.workspace_requires_mfa && !s.enabled && (
        <div className="error" style={{ marginBottom: 12 }}>
          This workspace requires two-step verification. Set it up below to keep using Meridian.
        </div>
      )}
      <p className="muted">
        {s?.enabled
          ? `On. ${s.recovery_codes_remaining} recovery code${s.recovery_codes_remaining === 1 ? "" : "s"} left.`
          : "Add an authenticator app (1Password, Google Authenticator, Authy…) so a stolen password is not enough."}
      </p>
      {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
      {!s?.enabled && !setup && !codes && (
        <button className="primary" disabled={enroll.isPending} onClick={() => enroll.mutate()}>
          Set up authenticator app
        </button>
      )}
      {setup && (
        <div>
          <p>Scan this QR code with your authenticator app, or enter the key by hand:</p>
          <div className="row-gap" style={{ alignItems: "flex-start" }}>
            <img src={setup.qr} alt="Authenticator QR code" width={200} height={200} />
            <div>
              <code style={{ wordBreak: "break-all" }}>{setup.secret}</code>
              <label>
                6-digit code from the app
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              {msg && (
                <div className="error" style={{ marginTop: 10 }}>
                  {msg}
                </div>
              )}
              <div className="row-gap" style={{ marginTop: 12 }}>
                <button
                  className="primary"
                  disabled={code.length !== 6 || confirm.isPending}
                  onClick={() => confirm.mutate()}
                >
                  Turn on
                </button>
                <button className="secondary" onClick={() => setSetup(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {s?.enabled && !codes && (
        <div>
          <div className="row-gap">
            <button
              className="secondary"
              onClick={() => {
                const c = window.prompt("Enter a current authenticator code to generate new recovery codes");
                if (c) regenerate.mutate(c);
              }}
            >
              New recovery codes
            </button>
            {!s.workspace_requires_mfa && (
              <button className="secondary" onClick={() => setOff({ ...off, open: !off.open })}>
                Turn off
              </button>
            )}
          </div>
          {off.open && (
            <div style={{ marginTop: 12 }}>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={off.password}
                  onChange={(e) => setOff({ ...off, password: e.target.value })}
                />
              </label>
              <label>
                Authenticator or recovery code
                <input value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value })} />
              </label>
              {msg && (
                <div className="error" style={{ marginTop: 10 }}>
                  {msg}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <button
                  className="primary"
                  disabled={!off.password || !off.code || disable.isPending}
                  onClick={() => disable.mutate()}
                >
                  Turn off two-step verification
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {policy.data && (
        <label className="row-gap" style={{ marginTop: 18, fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={policy.data.require_mfa}
            disabled={setPolicy.isPending || (!s?.enabled && !policy.data.require_mfa)}
            onChange={(e) => setPolicy.mutate(e.target.checked)}
          />
          Require two-step verification for everyone in this workspace
          <span className="muted">
            {" "}
            ({policy.data.members_without_mfa} member{policy.data.members_without_mfa === 1 ? "" : "s"}{" "}
            without it)
          </span>
        </label>
      )}
    </div>
  );
}
