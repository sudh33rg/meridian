import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Trash2, GitBranch } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { shortDay } from "./agile-shared";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

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
    <Card className="panel integrations space-y-4 p-4 sm:p-6" aria-labelledby="tokens-title">
      <CardHeader className="pb-2 border-b border-border">
        <CardTitle id="tokens-title" className="text-base font-bold text-text-main flex items-center gap-2">
          <KeyRound size={18} className="text-accent" aria-hidden /> Personal API tokens
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <p className="text-xs sm:text-sm text-text-subtle">
          Use a token as <code>Authorization: Bearer mtk_…</code>. A read token can only read. Tokens are
          shown once and can be revoked at any time.
        </p>

        <form
          className="flex flex-col sm:flex-row gap-2 items-center my-1.5 [&_input]:min-h-8 [&_select]:min-h-8 flex-wrap"
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
          <input
            aria-label="Token name"
            placeholder="Name, e.g. CI reader"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 px-3 py-1.5 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <select
            aria-label="Token scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="px-2.5 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main"
          >
            <option value="read">Read only</option>
            <option value="write">Read and write</option>
          </select>
          <select
            aria-label="Expiry"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="px-2.5 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main"
          >
            <option value="">No expiry</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">365 days</option>
          </select>
          <button
            className="px-4 py-1.5 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs font-medium transition-colors shadow-sm disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px]"
            disabled={!name.trim()}
          >
            Create token
          </button>
        </form>

        {fresh && (
          <div
            className="similar-hint p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 space-y-2 text-xs"
            role="status"
          >
            <b className="block font-semibold">Copy this token now. It will not be shown again.</b>
            <div className="flex flex-wrap items-center gap-2 my-1.5 [&_input]:min-h-8 [&_select]:min-h-8">
              <code className="p-2 bg-bg border border-border rounded-lg font-mono text-xs text-text-main select-all flex-1 min-w-[200px] break-all px-1.5 py-1">
                {fresh}
              </code>
              <button
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-text-main hover:bg-surface-3 justify-center whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] hover:text-text-main"
                onClick={() => navigator.clipboard?.writeText(fresh).then(() => toast("Token copied"))}
              >
                <Copy size={13} /> Copy
              </button>
              <button
                className="px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-text-main inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] hover:bg-surface-3 hover:text-text-main"
                onClick={() => setFresh(null)}
              >
                Done
              </button>
            </div>
          </div>
        )}

        <ul
          className="divide-y divide-border/60 border border-border rounded-xl overflow-hidden list-none my-1 p-0 flex flex-col gap-1"
          aria-label="API tokens"
        >
          {(tokens.data ?? []).map((t) => (
            <li
              key={t.id}
              className="checklist-row flex items-center justify-between p-3 text-xs hover:bg-surface-2 transition-colors"
            >
              <div>
                <b className="text-text-main font-semibold mr-1.5">{t.name}</b>{" "}
                <span className="mono font-mono text-text-subtle">{t.prefix}…</span> ·{" "}
                <span className="text-accent font-medium">{t.scope}</span> · created{" "}
                <span className="font-mono">{shortDay(t.created_at)}</span>
                {t.last_used_at ? ` · last used ${shortDay(t.last_used_at)}` : " · never used"}
                {t.revoked_at ? (
                  <span className="text-rose-500 ml-1 font-semibold">· revoked</span>
                ) : t.expires_at ? (
                  <span className="text-text-subtle ml-1 font-mono">· expires {shortDay(t.expires_at)}</span>
                ) : (
                  ""
                )}
              </div>
              {!t.revoked_at && (
                <button
                  className="icon-ghost p-1.5 text-text-subtle hover:text-danger rounded-lg transition-colors"
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
          {!(tokens.data ?? []).length && (
            <li className="p-4 text-center text-xs text-text-subtle">No personal tokens created yet.</li>
          )}
        </ul>
      </CardContent>
    </Card>
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
    <Card className="panel integrations space-y-4 p-4 sm:p-6" aria-labelledby="git-title">
      <CardHeader className="pb-2 border-b border-border">
        <CardTitle id="git-title" className="text-base font-bold text-text-main flex items-center gap-2">
          <GitBranch size={18} className="text-accent" /> Git linking · {project.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <p className="text-xs sm:text-sm text-text-subtle">
          Commits and pull requests that name an issue key ({project.key}-123) link to that issue. Point your
          repository’s webhook at the address below, with JSON content and the same secret, and send push and
          pull request events.
        </p>
        <p className="text-xs sm:text-sm text-text-main">
          Address:{" "}
          <code className="p-1.5 bg-bg border border-border rounded font-mono text-xs select-all text-accent break-all px-1.5 py-1">
            {url}
          </code>
        </p>
        <form
          className="flex flex-col sm:flex-row gap-2 items-center my-1.5 [&_input]:min-h-8 [&_select]:min-h-8 flex-wrap"
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
            className="flex-1 px-3 py-1.5 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            className="px-4 py-1.5 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs font-medium transition-colors shadow-sm disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px] border border-border-strong hover:text-text-main"
            disabled={secret.length < 16}
          >
            Save secret
          </button>
          <span className="text-xs text-text-subtle flex items-center">
            {status.data?.configured ? "A secret is set." : "No secret yet."}
          </span>
        </form>
      </CardContent>
    </Card>
  );
}
