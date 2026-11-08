import { formatDateTime } from "../../lib/datetime";
import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";

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
    <div className="ext-wrap">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="ok" role="status">
          {notice}
        </div>
      )}

      <div className="panel-card">
        <h3>
          <Building2 size={18} /> Verified domains
        </h3>
        <p className="muted">
          Prove you control an email domain before using it for single sign-on or provisioning. Publish the
          DNS TXT record (or the file) shown, then verify.
        </p>
        {(s?.domains ?? []).map((d) => (
          <div key={d.domain} className="panel-card" style={{ background: "#fafbfe" }}>
            <div className="row-gap" style={{ justifyContent: "space-between" }}>
              <b>{d.domain}</b>
              <span className="row-gap">
                <span className={"tag"}>{d.verified ? "Verified" : "Not verified"}</span>
                {!d.verified && (
                  <button
                    className="primary"
                    disabled={verify.isPending}
                    onClick={() => verify.mutate(d.domain)}
                  >
                    Verify
                  </button>
                )}
                <button className="secondary" onClick={() => dropDomain.mutate(d.domain)}>
                  Remove
                </button>
              </span>
            </div>
            {!d.verified && (
              <p className="muted small">
                DNS TXT <code>{d.txt_name}</code> = <code>{d.txt_value}</code>
                <br />
                or serve <code>{d.txt_value}</code> at <code>{d.file_url}</code>
              </p>
            )}
          </div>
        ))}
        <div className="row-gap">
          <input
            aria-label="Domain"
            placeholder="example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <button
            className="primary"
            disabled={!domain || addDomain.isPending}
            onClick={() => addDomain.mutate()}
          >
            Add domain
          </button>
        </div>
      </div>

      <div className="panel-card">
        <h3>Single sign-on (OpenID Connect)</h3>
        <p className="muted">
          Register this redirect URL with your identity provider: <code>{s?.callback_url}</code>. Members sign
          in at <code>{s?.login_url}</code>.
        </p>
        <label>
          Issuer URL
          <input
            value={form.issuer}
            placeholder="https://login.example.com"
            onChange={(e) => setForm({ ...form, issuer: e.target.value })}
          />
        </label>
        <label>
          Client ID
          <input value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
        </label>
        <label>
          Client secret {s?.configured && <span className="muted">(leave blank to keep the stored one)</span>}
          <input
            type="password"
            autoComplete="off"
            value={form.client_secret}
            onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
          />
        </label>
        <label>
          Role for newly provisioned people
          <select
            value={form.default_role}
            onChange={(e) => setForm({ ...form, default_role: e.target.value })}
          >
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
            <option value="guest">Guest</option>
          </select>
        </label>
        <label className="row-gap" style={{ fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={form.jit_provisioning}
            onChange={(e) => setForm({ ...form, jit_provisioning: e.target.checked })}
          />
          Create accounts on first sign-in (verified domains only)
        </label>
        <label className="row-gap" style={{ fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={form.enforce_sso}
            onChange={(e) => setForm({ ...form, enforce_sso: e.target.checked })}
          />
          Require SSO (password sign-in is refused; owners keep a break-glass password)
        </label>
        <label className="row-gap" style={{ fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Enable single sign-on
        </label>
        <div className="row-gap" style={{ marginTop: 12 }}>
          <button
            className="primary"
            disabled={save.isPending || !form.issuer || !form.client_id}
            onClick={() => save.mutate()}
          >
            Save
          </button>
          {s?.configured && (
            <button className="secondary" onClick={() => remove.mutate()}>
              Remove SSO
            </button>
          )}
        </div>
      </div>

      <div className="panel-card">
        <h3>SCIM provisioning</h3>
        <p className="muted">
          Let your identity provider create and deactivate members and teams automatically. Point it at{" "}
          <code>/scim/v2</code> with a bearer token. Only emails from verified domains are accepted.
        </p>
        {fresh && (
          <div className="ok" role="status">
            <b>Copy this token now; it is shown once.</b>
            <pre style={{ margin: "8px 0", wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
              {fresh.token}
            </pre>
            Base URL: <code>{fresh.base_url}</code>{" "}
            <button className="secondary" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        )}
        <table className="panel-table">
          <tbody>
            {(tokens.data ?? []).map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="muted">
                  {t.last_used_at ? `last used ${formatDateTime(t.last_used_at)}` : "never used"}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button className="secondary" onClick={() => revoke.mutate(t.id)}>
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {!(tokens.data ?? []).length && (
              <tr>
                <td className="muted">No tokens yet.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="row-gap" style={{ marginTop: 10 }}>
          <input
            aria-label="Token name"
            placeholder="Okta production"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
          />
          <button className="primary" disabled={!tokenName || mint.isPending} onClick={() => mint.mutate()}>
            Create token
          </button>
        </div>
      </div>
    </div>
  );
}
