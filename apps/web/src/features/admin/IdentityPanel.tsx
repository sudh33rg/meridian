import { formatDateTime } from "../../lib/datetime";
import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Shield, KeyRound } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

type Domain = { domain: string; verified: boolean; txt_name: string; txt_value: string; file_url: string };
type Sso = {
  configured: boolean;
  issuer: string | null;
  client_id: string | null;
  enabled: boolean;
  default_role: string;
  jit_provisioning: boolean;
  enforce_sso: boolean;
  callback_url: string;
  login_url: string;
  domains: Domain[];
};
type Token = { id: string; name: string; created_at: string; last_used_at: string | null };

export function IdentityPanel() {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fail = (e: unknown) => {
    setNotice("");
    setError(errorMessage(e));
  };
  const sso = useQuery({ queryKey: ["sso"], queryFn: () => api<Sso>("/workspace/sso") });
  const tokens = useQuery({
    queryKey: ["scim-tokens"],
    queryFn: () => api<Token[]>("/workspace/scim/tokens"),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["sso"] });

  const [form, setForm] = useState({
    issuer: "",
    client_id: "",
    client_secret: "",
    default_role: "member",
    jit_provisioning: true,
    enforce_sso: false,
    enabled: false,
  });
  useEffect(() => {
    const s = sso.data;
    if (s?.configured)
      setForm((f) => ({
        ...f,
        issuer: s.issuer ?? "",
        client_id: s.client_id ?? "",
        default_role: s.default_role,
        jit_provisioning: s.jit_provisioning,
        enforce_sso: s.enforce_sso,
        enabled: s.enabled,
      }));
  }, [sso.data]);
  const save = useMutation({
    mutationFn: () =>
      send<void>("/workspace/sso", "", "PUT", { ...form, client_secret: form.client_secret || undefined }),
    onSuccess: () => {
      setError("");
      setNotice("Single sign-on settings saved.");
      setForm((f) => ({ ...f, client_secret: "" }));
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => send<void>("/workspace/sso", "", "DELETE"),
    onSuccess: refresh,
    onError: fail,
  });

  const [domain, setDomain] = useState("");
  const addDomain = useMutation({
    mutationFn: () => send<unknown>("/workspace/domains", "", "POST", { domain }),
    onSuccess: () => {
      setDomain("");
      setError("");
      refresh();
    },
    onError: fail,
  });
  const verify = useMutation({
    mutationFn: (d: string) => send<void>(`/workspace/domains/${d}/verify`, "", "POST"),
    onSuccess: () => {
      setError("");
      setNotice("Domain verified.");
      refresh();
    },
    onError: fail,
  });
  const dropDomain = useMutation({
    mutationFn: (d: string) => send<void>(`/workspace/domains/${d}`, "", "DELETE"),
    onSuccess: refresh,
    onError: fail,
  });

  const [tokenName, setTokenName] = useState("");
  const [fresh, setFresh] = useState<{ token: string; base_url: string } | null>(null);
  const mint = useMutation({
    mutationFn: () =>
      send<{ token: string; base_url: string }>("/workspace/scim/tokens", "", "POST", { name: tokenName }),
    onSuccess: (r) => {
      setFresh(r);
      setTokenName("");
      setError("");
      qc.invalidateQueries({ queryKey: ["scim-tokens"] });
    },
    onError: fail,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => send<void>(`/workspace/scim/tokens/${id}`, "", "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scim-tokens"] }),
    onError: fail,
  });

  const s = sso.data;
  return (
    <div className="ext-wrap space-y-6">
      <PageHeader
        title="Identity & Access"
        subtitle="Configure verified domain ownership, single sign-on (OIDC), and automated SCIM provisioning."
      />

      {error && (
        <div
          className="p-3.5 rounded-xl bg-danger/10 border border-danger/20 text-danger text-xs sm:text-sm py-[11px] px-[13px] my-3"
          role="alert"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs sm:text-sm font-medium px-3 py-2.5"
          role="status"
        >
          {notice}
        </div>
      )}

      {/* Verified Domains Card */}
      <Card className="space-y-4 bg-surface border border-border rounded-[var(--radius-lg)] p-[18px] mb-[18px] overflow-x-auto shadow-[var(--shadow-sm)] [&_h3]:m-0 [&_h3]:mb-1 [&_select]:min-w-0 [&_select]:px-3 [&_select]:py-[9px] [&_select]:border [&_select]:border-border-strong [&_select]:rounded-[10px] [&_select]:bg-surface [&_select]:text-inherit [&_input]:min-w-0 [&_input]:px-3 [&_input]:py-[9px] [&_input]:border [&_input]:border-border-strong [&_input]:rounded-[10px] [&_input]:bg-surface [&_input]:text-inherit [&_label]:grid [&_label]:gap-1.5 [&_label]:text-[13px] [&_label]:font-semibold [&_label]:text-text-muted [&_label]:mt-2.5">
        <CardHeader className="pb-2 border-b border-border">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle flex items-center gap-2">
            <Building2 size={16} /> Verified domains
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <p className="text-xs sm:text-sm text-text-subtle">
            Prove you control an email domain before using it for single sign-on or provisioning. Publish the
            DNS TXT record (or the file) shown, then verify.
          </p>
          <div className="space-y-3">
            {(s?.domains ?? []).map((d) => (
              <div key={d.domain} className="p-3.5 rounded-xl border border-border bg-surface-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b className="text-text-main text-sm font-semibold">{d.domain}</b>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-block ${
                        d.verified
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                      }`}
                    >
                      {d.verified ? "Verified" : "Not verified"}
                    </span>
                    {!d.verified && (
                      <button
                        className="px-2.5 py-1 bg-accent hover:bg-accent-strong text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] shadow-[var(--shadow-sm)]"
                        disabled={verify.isPending}
                        onClick={() => verify.mutate(d.domain)}
                      >
                        Verify
                      </button>
                    )}
                    <button
                      className="px-2.5 py-1 bg-surface hover:bg-danger/10 hover:text-danger border border-border rounded-lg text-xs font-medium text-text-main transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)]"
                      onClick={() => dropDomain.mutate(d.domain)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {!d.verified && (
                  <div className="text-xs text-text-subtle font-mono p-2.5 bg-bg rounded-lg border border-border space-y-1">
                    <div>
                      DNS TXT <code>{d.txt_name}</code> = <code>{d.txt_value}</code>
                    </div>
                    <div>
                      or serve <code>{d.txt_value}</code> at <code>{d.file_url}</code>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2 sm:flex-wrap items-stretch sm:items-center">
            <input
              aria-label="Domain"
              placeholder="company.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="flex-1 px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              className="px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs sm:text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] shadow-[var(--shadow-sm)]"
              disabled={!domain || addDomain.isPending}
              onClick={() => addDomain.mutate()}
            >
              Add domain
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Single Sign-On (OpenID Connect) */}
      <Card className="space-y-4 bg-surface border border-border rounded-[var(--radius-lg)] p-[18px] mb-[18px] overflow-x-auto shadow-[var(--shadow-sm)] [&_h3]:m-0 [&_h3]:mb-1 [&_select]:min-w-0 [&_select]:px-3 [&_select]:py-[9px] [&_select]:border [&_select]:border-border-strong [&_select]:rounded-[10px] [&_select]:bg-surface [&_select]:text-inherit [&_input]:min-w-0 [&_input]:px-3 [&_input]:py-[9px] [&_input]:border [&_input]:border-border-strong [&_input]:rounded-[10px] [&_input]:bg-surface [&_input]:text-inherit [&_label]:grid [&_label]:gap-1.5 [&_label]:text-[13px] [&_label]:font-semibold [&_label]:text-text-muted [&_label]:mt-2.5">
        <CardHeader className="pb-2 border-b border-border">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle flex items-center gap-2">
            <Shield size={16} /> Single sign-on (OpenID Connect)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <p className="text-xs sm:text-sm text-text-subtle">
            Register this redirect URL with your identity provider:{" "}
            <code className="p-1 bg-surface-2 rounded text-text-main font-mono">{s?.callback_url}</code>.
            Members sign in at{" "}
            <code className="p-1 bg-surface-2 rounded text-text-main font-mono">{s?.login_url}</code>.
          </p>
          <div className="space-y-3">
            <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
              <span>Issuer URL</span>
              <input
                value={form.issuer}
                placeholder="https://login.example.com"
                onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
              <span>Client ID</span>
              <input
                value={form.client_id}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
              <span>
                Client secret{" "}
                {s?.configured && (
                  <span className="text-text-subtle text-xs font-normal">(leave blank to keep stored)</span>
                )}
              </span>
              <input
                type="password"
                autoComplete="off"
                value={form.client_secret}
                onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
              <span>Role for newly provisioned people</span>
              <select
                value={form.default_role}
                onChange={(e) => setForm({ ...form, default_role: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
                <option value="guest">Guest</option>
              </select>
            </label>
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-text-main cursor-pointer flex-wrap">
                <input
                  type="checkbox"
                  checked={form.jit_provisioning}
                  onChange={(e) => setForm({ ...form, jit_provisioning: e.target.checked })}
                  className="rounded text-accent focus:ring-accent"
                />
                Create accounts on first sign-in (verified domains only)
              </label>
              <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-text-main cursor-pointer flex-wrap">
                <input
                  type="checkbox"
                  checked={form.enforce_sso}
                  onChange={(e) => setForm({ ...form, enforce_sso: e.target.checked })}
                  className="rounded text-accent focus:ring-accent"
                />
                Require SSO (password sign-in is refused; owners keep break-glass password)
              </label>
              <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-text-main cursor-pointer flex-wrap">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  className="rounded text-accent focus:ring-accent"
                />
                Enable single sign-on
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-border">
            <button
              className="px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs sm:text-sm font-medium transition-colors disabled:opacity-50 shadow-sm inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)]"
              disabled={save.isPending || !form.issuer || !form.client_id}
              onClick={() => save.mutate()}
            >
              Save SSO
            </button>
            {s?.configured && (
              <button
                className="px-4 py-2 bg-surface-2 hover:bg-danger/10 hover:text-danger border border-border rounded-xl text-xs sm:text-sm font-medium text-text-main transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)]"
                onClick={() => remove.mutate()}
              >
                Remove SSO
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* SCIM Provisioning Card */}
      <Card className="space-y-4 bg-surface border border-border rounded-[var(--radius-lg)] p-[18px] mb-[18px] overflow-x-auto shadow-[var(--shadow-sm)] [&_h3]:m-0 [&_h3]:mb-1 [&_select]:min-w-0 [&_select]:px-3 [&_select]:py-[9px] [&_select]:border [&_select]:border-border-strong [&_select]:rounded-[10px] [&_select]:bg-surface [&_select]:text-inherit [&_input]:min-w-0 [&_input]:px-3 [&_input]:py-[9px] [&_input]:border [&_input]:border-border-strong [&_input]:rounded-[10px] [&_input]:bg-surface [&_input]:text-inherit [&_label]:grid [&_label]:gap-1.5 [&_label]:text-[13px] [&_label]:font-semibold [&_label]:text-text-muted [&_label]:mt-2.5">
        <CardHeader className="pb-2 border-b border-border">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle flex items-center gap-2">
            <KeyRound size={16} /> SCIM provisioning
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <p className="text-xs sm:text-sm text-text-subtle">
            Let your identity provider create and deactivate members and teams automatically. Point it at{" "}
            <code className="p-1 bg-surface-2 rounded text-text-main font-mono">/scim/v2</code> with a bearer
            token. Only emails from verified domains are accepted.
          </p>
          {fresh && (
            <div
              className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 space-y-2 text-xs sm:text-sm px-3 py-2.5"
              role="status"
            >
              <b>Copy this token now; it is shown once.</b>
              <pre className="p-3 bg-bg rounded-lg border border-border font-mono text-xs overflow-x-auto text-text-main">
                {fresh.token}
              </pre>
              <div className="flex items-center justify-between">
                <span>
                  Base URL: <code>{fresh.base_url}</code>
                </span>
                <button
                  className="px-2.5 py-1 bg-surface border border-border rounded-lg text-xs inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:bg-surface-3 hover:text-text-main"
                  onClick={() => setFresh(null)}
                >
                  Done
                </button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto border border-border rounded-xl">
            <table className="w-full text-left text-xs sm:text-sm border-collapse [&_th]:text-left [&_th]:px-2 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-border [&_td]:text-left [&_td]:px-2 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-border">
              <tbody className="divide-y divide-border/60">
                {(tokens.data ?? []).map((t) => (
                  <tr key={t.id} className="hover:bg-surface-2 transition-colors">
                    <td className="p-3 font-medium text-text-main">{t.name}</td>
                    <td className="p-3 text-text-subtle">
                      {t.last_used_at ? `last used ${formatDateTime(t.last_used_at)}` : "never used"}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        className="px-2.5 py-1 bg-surface-2 hover:bg-danger/10 hover:text-danger border border-border rounded-lg text-xs transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted"
                        onClick={() => revoke.mutate(t.id)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
                {!(tokens.data ?? []).length && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-xs text-text-subtle">
                      No tokens yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2 sm:flex-wrap items-stretch sm:items-center">
            <input
              aria-label="Token name"
              placeholder="Token name (e.g. Okta production)"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              className="flex-1 px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              className="px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs sm:text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] shadow-[var(--shadow-sm)]"
              disabled={!tokenName || mint.isPending}
              onClick={() => mint.mutate()}
            >
              Create token
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
