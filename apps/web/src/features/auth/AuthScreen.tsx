import React, { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import type { Session } from "../../lib/types";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (s: Session) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [authForm, setAuthForm] = useState({ organization: "", slug: "", name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const authenticate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onAuthenticated(
        await api<Session>("/auth/" + mode, undefined, {
          method: "POST",
          body: JSON.stringify(
            mode === "login"
              ? { slug: authForm.slug, email: authForm.email, password: authForm.password }
              : authForm,
          ),
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-layout">
      <div className="auth-hero">
        <div className="brand large">
          <span className="mark">M</span>
          <span>
            meridian<span className="brand-dot">.</span>
          </span>
        </div>
        <div className="hero-copy">
          <div className="eyebrow">ONE SPACE. TOTAL CLARITY.</div>
          <h1>
            Great work happens
            <br />
            when everything <em>connects.</em>
          </h1>
          <p>Projects, people, and knowledge—beautifully connected in a workspace built for momentum.</p>
          <div className="hero-lines">
            <div />
            <div />
            <div />
          </div>
        </div>
        <div className="hero-bottom">
          DESIGNED FOR TEAMS THAT MOVE FORWARD <ArrowUpRight size={18} />
        </div>
      </div>
      <div className="auth-panel">
        <form className="auth-card" onSubmit={authenticate}>
          <div className="eyebrow blue">WELCOME TO MERIDIAN</div>
          <h2>{mode === "signup" ? "Build your next chapter." : "Welcome back."}</h2>
          <p>
            {mode === "signup"
              ? "Create your workspace and bring your team together."
              : "Sign in to continue your work."}
          </p>
          {mode === "signup" && (
            <>
              <label>
                Organization name
                <input
                  required
                  placeholder="Acme Studio"
                  value={authForm.organization}
                  onChange={(e) => setAuthForm({ ...authForm, organization: e.target.value })}
                />
              </label>
              <label>
                Your name
                <input
                  required
                  placeholder="Alex Morgan"
                  value={authForm.name}
                  onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                />
              </label>
            </>
          )}
          <label>
            Workspace URL / slug
            <input
              required
              placeholder="acme-studio"
              value={authForm.slug}
              onChange={(e) => setAuthForm({ ...authForm, slug: e.target.value.toLowerCase() })}
            />
          </label>
          <label>
            Work email
            <input
              type="email"
              required
              placeholder="alex@company.com"
              value={authForm.email}
              onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={mode === "signup" ? 12 : 1}
              placeholder="At least 12 characters"
              value={authForm.password}
              onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
            />
          </label>
          {mode === "login" && (
            <a className="link" href="/auth/forgot">
              Forgot password?
            </a>
          )}
          {error && <div className="error">{error}</div>}
          <button className="primary full" disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create workspace" : "Sign in"}{" "}
            <ArrowUpRight size={17} />
          </button>
          <div className="auth-switch">
            {mode === "signup" ? "Already have a workspace?" : "New to Meridian?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signup" ? "login" : "signup");
                setError("");
              }}
            >
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
