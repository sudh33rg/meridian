import React, { useState } from "react";
import { ArrowUpRight, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import type { Session } from "../../lib/types";
import { MfaChallenge } from "./AuthPages";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (s: Session) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [authForm, setAuthForm] = useState({
    organization: "",
    slug: "",
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState("");
  const ssoError = new URLSearchParams(window.location.search).get("sso_error");
  const ssoMessages: Record<string, string> = {
    not_configured: "Single sign-on is not set up for that workspace.",
    state: "The sign-in expired or was already used. Please try again.",
    provider: "The identity provider could not be reached or rejected the sign-in.",
    email_unverified: "Your identity provider did not confirm your email address.",
    domain: "Your email domain is not verified for this workspace.",
    denied: "You do not have access to this workspace.",
  };

  const startSso = () => {
    if (!authForm.slug.trim()) return setError("Enter your workspace URL / slug first.");
    window.location.assign(`/api/auth/sso/${encodeURIComponent(authForm.slug.trim())}/start`);
  };

  const authenticate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<Session>("/auth/" + mode, undefined, {
        method: "POST",
        body: JSON.stringify(
          mode === "login"
            ? { slug: authForm.slug, email: authForm.email, password: authForm.password }
            : authForm,
        ),
      });
      if (res.mfa_required && res.challenge) setChallenge(res.challenge);
      else onAuthenticated(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <MfaChallenge
        challenge={challenge}
        onAuthenticated={onAuthenticated}
        onCancel={() => setChallenge("")}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col lg:flex-row antialiased">
      {/* Brand Hero Side (Desktop & Tablet) */}
      <div className="w-full lg:w-5/12 xl:w-1/2 bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 text-white p-6 sm:p-10 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top: Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-display font-extrabold text-2xl text-white shadow-lg -rotate-3">
            M
          </div>
          <span className="font-display font-black text-2xl tracking-tight text-white">
            meridian<span className="text-indigo-400">.</span>
          </span>
        </div>

        {/* Center: Hero copy */}
        <div className="my-10 lg:my-0 relative z-10 max-w-lg">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 mb-6">
            <Sparkles size={13} /> ONE SPACE. TOTAL CLARITY.
          </div>
          <h1 className="text-3xl sm:text-4xl xl:text-5xl font-extrabold tracking-tight font-display leading-[1.15] text-white">
            Great work happens when everything{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-indigo-200 to-sky-300 italic font-serif font-normal">
              connects.
            </span>
          </h1>
          <p className="mt-4 text-base sm:text-lg text-slate-300 leading-relaxed">
            Projects, people, and knowledge — beautifully connected in a workspace built for high-velocity
            teams.
          </p>

          <div className="mt-8 space-y-3.5 pt-6 border-t border-white/10 hidden sm:block">
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <CheckCircle2 size={18} className="text-indigo-400 shrink-0" />
              <span>Full-lifecycle work tracking & Kanban boards</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <CheckCircle2 size={18} className="text-indigo-400 shrink-0" />
              <span>Real-time collaborative knowledge base</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <CheckCircle2 size={18} className="text-indigo-400 shrink-0" />
              <span>Sprints, velocity forecasting, and burndown metrics</span>
            </div>
          </div>
        </div>

        {/* Bottom banner */}
        <div className="pt-6 border-t border-white/10 text-xs font-bold tracking-wider uppercase text-slate-400 flex items-center justify-between relative z-10">
          <span>DESIGNED FOR TEAMS THAT MOVE FORWARD</span>
          <ArrowUpRight size={16} className="text-indigo-400" />
        </div>
      </div>

      {/* Auth Form Side */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 lg:p-12 relative">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl sm:shadow-2xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div>
            <div className="text-[11px] font-extrabold tracking-wider uppercase text-indigo-600 dark:text-indigo-400 mb-1.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
              WELCOME TO MERIDIAN
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight font-display m-0">
              {mode === "signup" ? "Build your next chapter." : "Welcome back."}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {mode === "signup"
                ? "Create your workspace and bring your team together."
                : "Sign in to continue your work."}
            </p>
          </div>

          {/* Form */}
          <form className="space-y-4" onSubmit={authenticate}>
            {mode === "signup" && (
              <>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    Organization name
                  </label>
                  <input
                    required
                    placeholder="Acme Studio"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm transition-colors"
                    value={authForm.organization}
                    onChange={(e) => setAuthForm({ ...authForm, organization: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    Your name
                  </label>
                  <input
                    required
                    placeholder="Alex Morgan"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm transition-colors"
                    value={authForm.name}
                    onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Workspace URL / slug
              </label>
              <input
                required
                placeholder="acme-studio"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm transition-colors"
                value={authForm.slug}
                onChange={(e) => setAuthForm({ ...authForm, slug: e.target.value.toLowerCase() })}
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Work email
              </label>
              <input
                type="email"
                required
                placeholder="alex@company.com"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm transition-colors"
                value={authForm.email}
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Password
                </label>
                {mode === "login" && (
                  <a
                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    href="/auth/forgot"
                  >
                    Forgot password?
                  </a>
                )}
              </div>
              <input
                type="password"
                required
                minLength={mode === "signup" ? 12 : 1}
                placeholder="At least 12 characters"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 text-sm transition-colors"
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
              />
            </div>

            {ssoError && (
              <div className="error p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">
                {ssoMessages[ssoError] ?? "Single sign-on failed."}
              </div>
            )}

            {error && (
              <div className="error p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">
                {error}
              </div>
            )}

            {mode === "login" && (
              <button
                type="button"
                className="w-full py-2.5 px-4 rounded-lg font-semibold text-sm border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer flex items-center justify-center gap-2"
                onClick={startSso}
              >
                <ShieldCheck size={16} /> Sign in with SSO
              </button>
            )}

            <button
              type="submit"
              className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-md shadow-indigo-500/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
              disabled={busy}
            >
              <span>{busy ? "Please wait…" : mode === "signup" ? "Create workspace" : "Sign in"}</span>
              <ArrowUpRight size={17} />
            </button>
          </form>

          {/* Switch mode */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center text-xs text-slate-600 dark:text-slate-400">
            {mode === "signup" ? "Already have a workspace?" : "New to Meridian?"}{" "}
            <button
              type="button"
              className="font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer ml-1"
              onClick={() => {
                setMode(mode === "signup" ? "login" : "signup");
                setError("");
              }}
            >
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
