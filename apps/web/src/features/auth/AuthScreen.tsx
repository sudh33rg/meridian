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
    <div className="min-h-screen bg-bg text-text-main flex flex-col lg:flex-row antialiased">
      {/* Brand Hero Side (Desktop & Tablet) */}
      <div className="w-full lg:w-5/12 xl:w-1/2 bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 text-white p-6 sm:p-10 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top: Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center font-display font-extrabold text-2xl text-on-accent shadow-lg -rotate-3">
            M
          </div>
          <span className="font-display font-black text-2xl tracking-tight text-white">
            meridian<span className="text-accent">.</span>
          </span>
        </div>

        {/* Center: Hero copy */}
        <div className="my-10 lg:my-0 relative z-10 max-w-lg">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-accent/20 text-white border border-accent/30 mb-6">
            <Sparkles size={13} /> ONE SPACE. TOTAL CLARITY.
          </div>
          <h1 className="text-3xl sm:text-4xl xl:text-5xl font-extrabold tracking-tight font-display leading-[1.15] text-white">
            Great work happens when everything{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-indigo-200 to-sky-300 italic font-serif font-normal">
              connects.
            </span>
          </h1>
          <p className="mt-4 text-base sm:text-lg text-white/80 leading-relaxed">
            Projects, people, and knowledge — beautifully connected in a workspace built for high-velocity
            teams.
          </p>

          <div className="mt-8 space-y-3.5 pt-6 border-t border-white/10 hidden sm:block">
            <div className="flex items-center gap-3 text-sm text-white/80">
              <CheckCircle2 size={18} className="text-accent shrink-0" />
              <span>Full-lifecycle work tracking & Kanban boards</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-white/80">
              <CheckCircle2 size={18} className="text-accent shrink-0" />
              <span>Real-time collaborative knowledge base</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-white/80">
              <CheckCircle2 size={18} className="text-accent shrink-0" />
              <span>Sprints, velocity forecasting, and burndown metrics</span>
            </div>
          </div>
        </div>

        {/* Bottom banner */}
        <div className="pt-6 border-t border-white/10 text-xs font-bold tracking-wider uppercase text-white/60 flex items-center justify-between relative z-10">
          <span>DESIGNED FOR TEAMS THAT MOVE FORWARD</span>
          <ArrowUpRight size={16} className="text-accent" />
        </div>
      </div>

      {/* Auth Form Side */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 lg:p-12 relative">
        <div className="w-full max-w-md bg-surface rounded-2xl shadow-xl sm:shadow-2xl border border-border p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div>
            <div className="text-[11px] font-extrabold tracking-wider uppercase text-accent mb-1.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              WELCOME TO MERIDIAN
            </div>
            <h2 className="text-2xl font-extrabold text-text-main tracking-tight font-display m-0">
              {mode === "signup" ? "Build your next chapter." : "Welcome back."}
            </h2>
            <p className="text-sm text-text-muted mt-1">
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
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                    Organization name
                  </label>
                  <input
                    required
                    placeholder="Acme Studio"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm transition-colors"
                    value={authForm.organization}
                    onChange={(e) => setAuthForm({ ...authForm, organization: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                    Your name
                  </label>
                  <input
                    required
                    placeholder="Alex Morgan"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm transition-colors"
                    value={authForm.name}
                    onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                Workspace URL / slug
              </label>
              <input
                required
                placeholder="acme-studio"
                className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm transition-colors"
                value={authForm.slug}
                onChange={(e) => setAuthForm({ ...authForm, slug: e.target.value.toLowerCase() })}
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                Work email
              </label>
              <input
                type="email"
                required
                placeholder="alex@company.com"
                className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm transition-colors"
                value={authForm.email}
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-text-main">Password</label>
                {mode === "login" && (
                  <a className="text-xs font-semibold text-accent hover:underline" href="/auth/forgot">
                    Forgot password?
                  </a>
                )}
              </div>
              <input
                type="password"
                required
                minLength={mode === "signup" ? 12 : 1}
                placeholder="At least 12 characters"
                className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-surface text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent/25 focus:border-accent text-sm transition-colors"
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
              />
            </div>

            {ssoError && (
              <div className="p-3 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs font-medium py-[11px] px-[13px] my-3">
                {ssoMessages[ssoError] ?? "Single sign-on failed."}
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs font-medium py-[11px] px-[13px] my-3">
                {error}
              </div>
            )}

            {mode === "login" && (
              <button
                type="button"
                className="w-full py-2.5 px-4 rounded-lg font-semibold text-sm border border-border bg-surface-2 hover:bg-surface-3 text-text-main transition-colors cursor-pointer flex items-center justify-center gap-2"
                onClick={startSso}
              >
                <ShieldCheck size={16} /> Sign in with SSO
              </button>
            )}

            <button
              type="submit"
              className="w-full py-3 px-4 rounded-lg font-semibold text-sm text-on-accent bg-accent hover:bg-accent-strong active:opacity-90 shadow-md shadow-accent/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
              disabled={busy}
            >
              <span>{busy ? "Please wait…" : mode === "signup" ? "Create workspace" : "Sign in"}</span>
              <ArrowUpRight size={17} />
            </button>
          </form>

          {/* Switch mode */}
          <div className="pt-4 border-t border-border text-center text-xs text-text-muted">
            {mode === "signup" ? "Already have a workspace?" : "New to Meridian?"}{" "}
            <button
              type="button"
              className="font-bold text-accent hover:underline cursor-pointer ml-1"
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
