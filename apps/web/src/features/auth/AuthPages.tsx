import React, { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import type { Session } from "../../lib/types";

export function Shell({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg text-text-main flex flex-col items-center justify-center p-4 sm:p-6 antialiased">
      <div className="mb-6 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center font-display font-extrabold text-xl text-on-accent shadow-md -rotate-3">
          M
        </div>
        <span className="font-display font-black text-2xl tracking-tight text-text-main">
          meridian<span className="text-accent">.</span>
        </span>
      </div>

      <div className="w-full max-w-md bg-surface rounded-2xl shadow-xl sm:shadow-2xl border border-border p-6 sm:p-8 space-y-6">
        <div>
          <div className="text-[11px] font-extrabold tracking-wider uppercase text-accent mb-1.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            MERIDIAN
          </div>
          <h2 className="text-2xl font-extrabold text-text-main tracking-tight font-display m-0">{title}</h2>
          {lead && <p className="text-sm text-text-muted mt-1 leading-relaxed">{lead}</p>}
        </div>
        <div className="space-y-4">{children}</div>
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
        <div className="p-4 rounded-xl bg-success-soft border border-success-border text-success-text text-xs sm:text-sm font-medium leading-relaxed px-3 py-2.5">
          If that address belongs to an account, a reset link is on its way. It expires in one hour.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
              Work email
            </label>
            <input
              type="email"
              required
              placeholder="alex@company.com"
              className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm transition-colors"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error && (
            <div className="p-3 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs font-medium py-[11px] px-[13px] my-3">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-on-accent bg-accent hover:bg-accent-strong active:opacity-90 shadow-md shadow-accent/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            disabled={busy}
          >
            <span>{busy ? "Please wait…" : "Send reset link"}</span>
            <ArrowUpRight size={17} />
          </button>
        </form>
      )}
      <div className="pt-4 border-t border-border text-center text-xs">
        <a className="font-semibold text-accent hover:underline" href="/">
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
        <div className="p-4 rounded-xl bg-success-soft border border-success-border text-success-text text-xs sm:text-sm font-medium px-3 py-2.5">
          Password changed. You can now sign in with the new password.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
              New password
            </label>
            <input
              type="password"
              required
              minLength={12}
              placeholder="At least 12 characters"
              className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm transition-colors"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div className="p-3 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs font-medium py-[11px] px-[13px] my-3">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-on-accent bg-accent hover:bg-accent-strong active:opacity-90 shadow-md shadow-accent/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            disabled={busy || !token}
          >
            <span>{busy ? "Please wait…" : "Change password"}</span>
            <ArrowUpRight size={17} />
          </button>
        </form>
      )}
      <div className="pt-4 border-t border-border text-center text-xs">
        <a className="font-semibold text-accent hover:underline" href="/">
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
        <div className="p-4 rounded-xl bg-success-soft border border-success-border text-success-text text-xs sm:text-sm font-medium px-3 py-2.5">
          Email confirmed. Thank you.
        </div>
      ) : (
        <div className="space-y-4">
          {state === "error" && (
            <div className="p-3 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs font-medium py-[11px] px-[13px] my-3">
              {error}
            </div>
          )}
          <button
            type="button"
            className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-on-accent bg-accent hover:bg-accent-strong active:opacity-90 shadow-md shadow-accent/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            disabled={state === "busy" || !token}
            onClick={confirm}
          >
            <span>{state === "busy" ? "Please wait…" : "Confirm email address"}</span>
            <ArrowUpRight size={17} />
          </button>
        </div>
      )}
      <div className="pt-4 border-t border-border text-center text-xs">
        <a className="font-semibold text-accent hover:underline" href="/">
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
        <div className="p-4 rounded-xl bg-warning-soft border border-warning-border text-warning-text text-xs sm:text-sm font-medium leading-relaxed px-3 py-2.5">
          You already have a Meridian account. Sign in with it, then open this invitation link again while
          signed in.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
              Your name
            </label>
            <input
              required
              placeholder="Alex Morgan"
              className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm transition-colors"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              minLength={12}
              placeholder="At least 12 characters"
              className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm transition-colors"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          {error && (
            <div className="p-3 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs font-medium py-[11px] px-[13px] my-3">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-on-accent bg-accent hover:bg-accent-strong active:opacity-90 shadow-md shadow-accent/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            disabled={busy || !token}
          >
            <span>{busy ? "Please wait…" : "Accept invitation"}</span>
            <ArrowUpRight size={17} />
          </button>
        </form>
      )}
      <div className="pt-4 border-t border-border text-center text-xs">
        <a className="font-semibold text-accent hover:underline" href="/">
          Back to sign in
        </a>
      </div>
    </Shell>
  );
}

/** Second step of sign-in for accounts with MFA: an authenticator code or a recovery code. */
export function MfaChallenge({
  challenge,
  onAuthenticated,
  onCancel,
}: {
  challenge: string;
  onAuthenticated: (s: Session) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onAuthenticated(
        await api<Session>("/auth/mfa/verify", undefined, {
          method: "POST",
          body: JSON.stringify({ challenge, code }),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Two-step verification"
      lead="Enter the 6-digit code from your authenticator app, or one of your recovery codes."
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
            Verification code
          </label>
          <input
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="text"
            placeholder="123456"
            className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm tracking-widest text-center font-mono font-bold transition-colors"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        {error && (
          <div className="p-3 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs font-medium py-[11px] px-[13px] my-3">
            {error}
          </div>
        )}
        <button
          type="submit"
          className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-on-accent bg-accent hover:bg-accent-strong active:opacity-90 shadow-md shadow-accent/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
          disabled={busy}
        >
          <span>{busy ? "Please wait…" : "Verify"}</span>
          <ArrowUpRight size={17} />
        </button>
      </form>
      <div className="pt-4 border-t border-border text-center text-xs">
        <button
          type="button"
          className="font-semibold text-text-muted hover:text-text-main cursor-pointer"
          onClick={onCancel}
        >
          Use a different account
        </button>
      </div>
    </Shell>
  );
}
