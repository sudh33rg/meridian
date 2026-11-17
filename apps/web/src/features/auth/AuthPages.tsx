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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 sm:p-6 antialiased">
      <div className="mb-6 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-display font-extrabold text-xl text-white shadow-md -rotate-3">
          M
        </div>
        <span className="font-display font-black text-2xl tracking-tight text-slate-900 dark:text-white">
          meridian<span className="text-indigo-600 dark:text-indigo-400">.</span>
        </span>
      </div>

      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl sm:shadow-2xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 space-y-6">
        <div>
          <div className="text-[11px] font-extrabold tracking-wider uppercase text-indigo-600 dark:text-indigo-400 mb-1.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
            MERIDIAN
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight font-display m-0">
            {title}
          </h2>
          {lead && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{lead}</p>}
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
        <div className="ok p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm font-medium leading-relaxed">
          If that address belongs to an account, a reset link is on its way. It expires in one hour.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Work email
            </label>
            <input
              type="email"
              required
              placeholder="alex@company.com"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm transition-colors"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error && (
            <div className="error p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-md shadow-indigo-500/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            disabled={busy}
          >
            <span>{busy ? "Please wait…" : "Send reset link"}</span>
            <ArrowUpRight size={17} />
          </button>
        </form>
      )}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-xs">
        <a className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline" href="/">
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
        <div className="ok p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm font-medium">
          Password changed. You can now sign in with the new password.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              New password
            </label>
            <input
              type="password"
              required
              minLength={12}
              placeholder="At least 12 characters"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm transition-colors"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <div className="error p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-md shadow-indigo-500/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            disabled={busy || !token}
          >
            <span>{busy ? "Please wait…" : "Change password"}</span>
            <ArrowUpRight size={17} />
          </button>
        </form>
      )}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-xs">
        <a className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline" href="/">
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
        <div className="ok p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm font-medium">
          Email confirmed. Thank you.
        </div>
      ) : (
        <div className="space-y-4">
          {state === "error" && (
            <div className="error p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">
              {error}
            </div>
          )}
          <button
            type="button"
            className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-md shadow-indigo-500/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            disabled={state === "busy" || !token}
            onClick={confirm}
          >
            <span>{state === "busy" ? "Please wait…" : "Confirm email address"}</span>
            <ArrowUpRight size={17} />
          </button>
        </div>
      )}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-xs">
        <a className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline" href="/">
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
        <div className="ok p-4 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-xs sm:text-sm font-medium leading-relaxed">
          You already have a Meridian account. Sign in with it, then open this invitation link again while
          signed in.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Your name
            </label>
            <input
              required
              placeholder="Alex Morgan"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm transition-colors"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              minLength={12}
              placeholder="At least 12 characters"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm transition-colors"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          {error && (
            <div className="error p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-md shadow-indigo-500/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
            disabled={busy || !token}
          >
            <span>{busy ? "Please wait…" : "Accept invitation"}</span>
            <ArrowUpRight size={17} />
          </button>
        </form>
      )}
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-xs">
        <a className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline" href="/">
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
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
            Verification code
          </label>
          <input
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="text"
            placeholder="123456"
            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm tracking-widest text-center font-mono font-bold transition-colors"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        {error && (
          <div className="error p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">
            {error}
          </div>
        )}
        <button
          type="submit"
          className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-md shadow-indigo-500/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
          disabled={busy}
        >
          <span>{busy ? "Please wait…" : "Verify"}</span>
          <ArrowUpRight size={17} />
        </button>
      </form>
      <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-xs">
        <button
          type="button"
          className="font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
          onClick={onCancel}
        >
          Use a different account
        </button>
      </div>
    </Shell>
  );
}
