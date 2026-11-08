import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { shortDay } from "./agile-shared";

type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};
type Created = { token: string; info: ApiToken };
type GitStatus = { configured: boolean; webhook_path: string };

/** Personal API tokens. The secret is shown once, when it is created. */
export function ApiTokensPanel() {
  const { session, setError } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scope, setScope] = useState("read");
  const [days, setDays] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const tokens = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => request<ApiToken[]>(session.token, "/me/tokens"),
  });
  return (
    <section className="panel integrations" aria-labelledby="tokens-title">
      <h3 id="tokens-title">
        <KeyRound size={16} aria-hidden /> Personal API tokens
      </h3>
      <p className="muted small">
        Use a token as <code>Authorization: Bearer mtk_…</code>. A read token can only read. Tokens are shown once and
        can be revoked at any time.
      </p>
      <form
        className="row-actions wrap"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          try {
            const created = await send<Created>("/me/tokens", session.token, "POST", {
              name: name.trim(),
              scope,
              expires_days: days ? Number(days) : null,
            });
            setFresh(created.token);
            setName("");
            await qc.invalidateQueries({ queryKey: ["api-tokens"] });
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        <input aria-label="Token name" placeholder="Name, e.g. CI reader" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <select aria-label="Token scope" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="read">Read only</option>
          <option value="write">Read and write</option>
        </select>
        <select aria-label="Expiry" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="">No expiry</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">365 days</option>
        </select>
        <button className="primary small-btn" disabled={!name.trim()}>
          Create token
        </button>
      </form>
      {fresh && (
        <div className="similar-hint" role="status">
          <b>Copy this token now. It will not be shown again.</b>
          <div className="row-actions">
            <code className="token-secret">{fresh}</code>
            <button
              className="secondary small-btn"
              onClick={() => navigator.clipboard?.writeText(fresh).then(() => toast("Token copied"))}
            >
              <Copy size={14} /> Copy
            </button>
            <button className="secondary small-btn" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      <ul className="plain-list" aria-label="API tokens">
        {(tokens.data ?? []).map((t) => (
          <li key={t.id} className="small checklist-row">
            <span>
              <b>{t.name}</b> <span className="mono">{t.prefix}…</span> · {t.scope} · created {shortDay(t.created_at)}
              {t.last_used_at ? ` · last used ${shortDay(t.last_used_at)}` : " · never used"}
              {t.revoked_at ? " · revoked" : t.expires_at ? ` · expires ${shortDay(t.expires_at)}` : ""}
            </span>
            {!t.revoked_at && (
              <button
                className="icon-ghost"
                aria-label={`Revoke ${t.name}`}
                onClick={async () => {
                  try {
                    await send(`/me/tokens/${t.id}`, session.token, "DELETE");
                    await qc.invalidateQueries({ queryKey: ["api-tokens"] });
                    toast("Token revoked");
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Git linking for one project: set the signing secret and show where repository events go. */
export function GitLinkPanel() {
  const { session, selected, project, setError } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [secret, setSecret] = useState("");
  const status = useQuery({
    queryKey: ["git-secret", selected],
    queryFn: () => request<GitStatus>(session.token, `/projects/${selected}/git-secret`),
    enabled: !!selected,
  });
  if (!selected || !project) return null;
  const url = `${window.location.origin}${status.data?.webhook_path ?? `/api/integrations/git/${selected}`}`;
  return (
    <section className="panel integrations" aria-labelledby="git-title">
      <h3 id="git-title">Git linking · {project.name}</h3>
      <p className="muted small">
        Commits and pull requests that name an issue key ({project.key}-123) link to that issue. Point your repository’s
        webhook at the address below, with JSON content and the same secret, and send push and pull request events.
      </p>
      <p className="small">
        Address: <code className="token-secret">{url}</code>
      </p>
      <form
        className="row-actions wrap"
        onSubmit={async (e) => {
          e.preventDefault();
          if (secret.length < 16) return;
          try {
            await send(`/projects/${selected}/git-secret`, session.token, "PUT", { secret });
            setSecret("");
            await qc.invalidateQueries({ queryKey: ["git-secret", selected] });
            toast("Signing secret saved");
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        <input
          aria-label="Signing secret"
          type="password"
          autoComplete="new-password"
          placeholder={status.data?.configured ? "Replace the secret" : "Signing secret (16+ characters)"}
          value={secret}
          maxLength={200}
          onChange={(e) => setSecret(e.target.value)}
        />
        <button className="secondary small-btn" disabled={secret.length < 16}>
          Save secret
        </button>
        <span className="small muted">{status.data?.configured ? "A secret is set." : "No secret yet."}</span>
      </form>
    </section>
  );
}
