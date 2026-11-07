import React, { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import type { Session } from "../../lib/types";

function Shell({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <div className="auth-layout single">
      <div className="auth-panel">
        <div className="auth-card">
          <div className="eyebrow blue">MERIDIAN</div>
          <h2>{title}</h2>
          {lead && <p>{lead}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

const tokenFromUrl = () => new URLSearchParams(window.location.search).get("token") || "";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/forgot-password", undefined, { method: "POST", body: JSON.stringify({ email }) });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell
      title="Reset your password"
      lead="Enter your work email and we will send a link if an account exists."
    >
      {done ? (
        <div className="ok">
          If that address belongs to an account, a reset link is on its way. It expires in one hour.
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "contents" }}>
          <label>
            Work email
            <input
              type="email"
              required
              placeholder="alex@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary full" disabled={busy}>
            {busy ? "Please wait…" : "Send reset link"} <ArrowUpRight size={17} />
          </button>
        </form>
      )}
      <div className="auth-switch">
        <a className="link" href="/">
          Back to sign in
        </a>
      </div>
    </Shell>
  );
}

export function ResetPasswordPage() {
  const token = tokenFromUrl();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/reset-password", undefined, {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Choose a new password" lead="You will be signed out everywhere else once it changes.">
      {done ? (
        <div className="ok">Password changed. You can now sign in with the new password.</div>
      ) : (
        <form onSubmit={submit} style={{ display: "contents" }}>
          <label>
            New password
            <input
              type="password"
              required
              minLength={12}
              placeholder="At least 12 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary full" disabled={busy || !token}>
            {busy ? "Please wait…" : "Change password"} <ArrowUpRight size={17} />
          </button>
        </form>
      )}
      <div className="auth-switch">
        <a className="link" href="/">
          Go to sign in
        </a>
      </div>
    </Shell>
  );
}

export function VerifyEmailPage() {
  const token = tokenFromUrl();
  const [state, setState] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [error, setError] = useState("");
  const confirm = async () => {
    setState("busy");
    try {
      await api("/auth/verify-email", undefined, { method: "POST", body: JSON.stringify({ token }) });
      setState("ok");
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  };
  return (
    <Shell title="Confirm your email" lead="One click and your address is verified.">
      {state === "ok" ? (
        <div className="ok">Email confirmed. Thank you.</div>
      ) : (
        <>
          {state === "error" && <div className="error">{error}</div>}
          <button className="primary full" disabled={state === "busy" || !token} onClick={confirm}>
            {state === "busy" ? "Please wait…" : "Confirm email address"} <ArrowUpRight size={17} />
          </button>
        </>
      )}
      <div className="auth-switch">
        <a className="link" href="/">
          Open Meridian
        </a>
      </div>
    </Shell>
  );
}

export function AcceptInvitePage({ onAuthenticated }: { onAuthenticated: (s: Session) => void }) {
  const token = tokenFromUrl();
  const [form, setForm] = useState({ name: "", password: "" });
  const [error, setError] = useState("");
  const [existing, setExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const s = await api<Session>("/auth/accept-invite", undefined, {
        method: "POST",
        body: JSON.stringify({ token, name: form.name, password: form.password }),
      });
      onAuthenticated(s);
      window.history.replaceState(null, "", "/");
    } catch (err) {
      const msg = errorMessage(err);
      if (/existing account/i.test(msg)) setExisting(true);
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Join your team" lead="Create your account to accept the invitation.">
      {existing ? (
        <div className="ok">
          You already have a Meridian account. Sign in with it, then open this invitation link again while
          signed in.
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "contents" }}>
          <label>
            Your name
            <input
              required
              placeholder="Alex Morgan"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={12}
              placeholder="At least 12 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary full" disabled={busy || !token}>
            {busy ? "Please wait…" : "Accept invitation"} <ArrowUpRight size={17} />
          </button>
        </form>
      )}
      <div className="auth-switch">
        <a className="link" href="/">
          Back to sign in
        </a>
      </div>
    </Shell>
  );
}
