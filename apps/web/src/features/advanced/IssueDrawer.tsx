import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTeams } from "../agile/agile-shared";
import { IssueDepth } from "../agile/IssueDepth";
import { EntityRelations } from "./EntityRelations";
import { Attachments } from "../shared/Attachments";
import { Star, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, request, requestWithHeaders, send } from "../../lib/api";
import type { ProjectStatus } from "../../lib/statuses";
import { displayValue, toPayload, type FieldDefinition } from "../../lib/fields";
import type { Item } from "../../lib/types";
import { str, day } from "./shared";
import { useWorkspace } from "../workspace/useWorkspace";
import { Markdown } from "../../lib/markdown";
import { t } from "../../lib/i18n";
import { CommentReactions, Reminders } from "./IssueContent";

type CommentHistory = {
  current_body: string;
  deleted: boolean;
  revisions: { body: string; author: string; changed_by: string; change: string; changed_at: string }[];
};

/** Members do not see restricted fields; project admins see all of them. */
function visibleFields(fields: FieldDefinition[], canSeeRestricted: boolean): FieldDefinition[] {
  return canSeeRestricted ? fields : fields.filter((f) => !f.restricted);
}

export function IssueDrawer({
  id,
  token,
  onClose,
  onChanged,
}: {
  id: string;
  token: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [issue, setIssue] = useState<Item | null>(null),
    [comments, setComments] = useState<Item[]>([]),
    [body, setBody] = useState(""),
    [title, setTitle] = useState(""),
    [priority, setPriority] = useState("medium"),
    [status, setStatus] = useState("todo"),
    [error, setError] = useState(""),
    [values, setValues] = useState<Record<string, unknown>>({});
  // The ETag of the issue as last loaded; sent back as If-Match so a stale save is refused.
  const etag = useRef<string | null>(null);
  // The issue's project defines which statuses it can take.
  const projectId = issue ? str(issue.project_id) : "";
  const statusesQ = useQuery({
    queryKey: ["statuses", projectId],
    queryFn: () => request<ProjectStatus[]>(token, `/projects/${projectId}/statuses`),
    enabled: !!projectId,
  });
  const fieldsQ = useQuery({
    queryKey: ["fields", projectId],
    queryFn: () => request<FieldDefinition[]>(token, `/projects/${projectId}/fields`),
    enabled: !!projectId,
  });
  const teamsQ = useTeams(token);
  // AI assistance (opt-in per workspace): summaries and a priority suggestion, shown here and not stored.
  const aiQ = useQuery({
    queryKey: ["ai-settings"],
    queryFn: () => request<{ enabled: boolean; configured: boolean }>(token, "/workspace/ai"),
    retry: false,
  });
  const [aiResult, setAiResult] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const runAi = async (kind: "summary" | "triage") => {
    setAiBusy(true);
    setAiResult("");
    try {
      if (kind === "summary") {
        const r = await send<{ text: string }>(`/projects/${projectId}/ai/summary`, token, "POST", {
          issue_id: id,
        });
        setAiResult(r.text);
      } else {
        const r = await send<{ priority: string; reason: string }>(
          `/projects/${projectId}/ai/triage`,
          token,
          "POST",
          { issue_id: id },
        );
        setAiResult(`Suggested priority: ${r.priority}. ${r.reason}`);
      }
    } catch (e) {
      setAiResult((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };
  // Security level: who may see this issue. Project admins change it; everyone sees its name.
  const levelsQ = useQuery({
    queryKey: ["security-levels", projectId],
    queryFn: () =>
      request<{ can_manage: boolean; levels: { id: string; name: string }[] }>(
        token,
        `/projects/${projectId}/security-levels`,
      ),
    enabled: !!projectId,
  });
  const issueLevelQ = useQuery({
    queryKey: ["issue-security", id],
    queryFn: () =>
      request<{ level_id: string | null; name: string | null }>(token, `/issues/${id}/security-level`),
    enabled: !!id,
  });
  const setLevel = useMutation({
    mutationFn: (levelId: string | null) =>
      send(`/issues/${id}/security-level`, token, "PUT", { level_id: levelId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["issue-security", id] });
      onChanged();
    },
    onError: (e) => setError((e as Error).message),
  });
  // A move to another status can show fields of its transition screen; the drawer says which.
  const currentStatus = issue ? str(issue.status) : "";
  const screenQ = useQuery({
    queryKey: ["transition-screen", projectId, currentStatus, status],
    queryFn: () =>
      request<{ fields: string[] }>(
        token,
        `/projects/${projectId}/transitions/${currentStatus}/${status}/screen`,
      ),
    enabled: !!projectId && !!currentStatus && status !== currentStatus,
    retry: false,
  });
  const { me } = useWorkspace();
  // Comment editing: the comment being edited, its draft text, and the history currently open.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null),
    [openHistory, setOpenHistory] = useState<{ id: string; data: CommentHistory } | null>(null);
  const reload = useCallback(async () => {
    try {
      const [details, c] = await Promise.all([
        requestWithHeaders<Item>(token, `/issues/${id}/details`),
        request<Item[]>(token, `/issues/${id}/comments`),
      ]);
      etag.current = details.headers.get("etag");
      const i = details.data;
      setIssue(i);
      setTitle(str(i.title));
      setPriority(str(i.priority));
      setStatus(str(i.status));
      setValues((i.custom_fields ?? {}) as Record<string, unknown>);
      setComments(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, token]);
  useEffect(() => {
    void reload();
  }, [reload]);
  // Favourites are this member's own list for the project; the star in the header toggles them.
  const qc = useQueryClient();
  const favouritesQ = useQuery({
    queryKey: ["favourites", projectId],
    queryFn: () => request<Item[]>(token, `/projects/${projectId}/favourites`),
    enabled: !!projectId,
  });
  const isFavourite = !!favouritesQ.data?.some((f) => str(f.id) === id);
  const toggleFavourite = useMutation({
    mutationFn: () => request(token, `/issues/${id}/favourite`, { method: isFavourite ? "DELETE" : "PUT" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favourites", projectId] }),
    onError: (e) => setError((e as Error).message),
  });
  // Opening an issue records it in this member's recent list. Failure here never blocks the drawer.
  useEffect(() => {
    void request(token, `/issues/${id}/viewed`, { method: "POST" })
      .then(() => qc.invalidateQueries({ queryKey: ["recent", projectId] }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);
  const save = async () => {
    try {
      await request(token, `/issues/${id}/edit`, {
        method: "PATCH",
        headers: etag.current ? { "If-Match": etag.current } : {},
        body: JSON.stringify({
          title,
          priority,
          status,
          ...(fieldsQ.isSuccess
            ? {
                custom_fields: toPayload(
                  visibleFields(fieldsQ.data ?? [], levelsQ.data?.can_manage ?? false),
                  values,
                ),
              }
            : {}),
        }),
      });
      await reload();
      onChanged();
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        const mine = { title, priority, status, values };
        await reload();
        setTitle(mine.title);
        setPriority(mine.priority);
        setStatus(mine.status);
        setValues(mine.values);
        setError(
          "This issue changed while you were editing. The latest version is loaded and your edits are kept; review them and save again.",
        );
        return;
      }
      setError((e as Error).message);
    }
  };
  const lifecycle = async (action: "archive" | "trash" | "restore") => {
    if (action === "trash" && !window.confirm("Move this issue to trash? You can restore it for 30 days."))
      return;
    try {
      await request(token, `/issues/${id}/${action}`, { method: "POST" });
      await reload();
      onChanged();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const comment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await request(token, `/issues/${id}/comments`, { method: "POST", body: JSON.stringify({ body }) });
      setBody("");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      await request(token, `/issues/${id}/comments/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body: editing.text }),
      });
      setEditing(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const deleteComment = async (commentId: string) => {
    if (!window.confirm("Delete this comment? It stays in the history for auditing.")) return;
    try {
      await request(token, `/issues/${id}/comments/${commentId}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const showHistory = async (commentId: string) => {
    if (openHistory?.id === commentId) {
      setOpenHistory(null);
      return;
    }
    try {
      const data = await request<CommentHistory>(token, `/issues/${id}/comments/${commentId}/history`);
      setOpenHistory({ id: commentId, data });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const isAdmin = me?.role === "admin" || me?.role === "owner";

  return (
    <div
      className="fixed inset-0 z-50 bg-overlay backdrop-blur-xs flex justify-end transition-opacity"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="w-full sm:max-w-xl md:max-w-2xl h-full bg-surface shadow-2xl border-l border-border overflow-y-auto p-4 sm:p-6 md:p-8 space-y-6 overflow-auto py-7 px-[35px] max-[900px]:p-5"
        role="dialog"
        aria-modal="true"
        aria-label="Issue details"
      >
        <div className="flex items-center justify-between pb-4 border-b border-border text-xs sm:text-sm mb-[30px] text-accent-text">
          <b className="font-mono text-accent uppercase tracking-wider font-bold">
            {issue ? str(issue.kind).toUpperCase() + " · " + str(issue.number) : "Loading issue"}
          </b>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={`p-2 rounded-lg transition-colors inline-flex items-center justify-center border ${
                isFavourite
                  ? "text-amber-500 hover:bg-amber-500/10"
                  : "text-text-subtle hover:text-text-main hover:bg-surface-2"
              }`}
              aria-pressed={isFavourite}
              aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
              title={isFavourite ? "Remove from favourites" : "Add to favourites"}
              disabled={!issue || toggleFavourite.isPending}
              onClick={() => toggleFavourite.mutate()}
            >
              <Star size={18} fill={isFavourite ? "currentColor" : "none"} />
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-2 rounded-lg text-text-subtle hover:text-text-main hover:bg-surface-2 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {error && (
          <div
            className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-xs sm:text-sm py-[11px] px-[13px] my-3"
            role="alert"
          >
            {error}
          </div>
        )}

        {issue && (
          <div className="space-y-6">
            {Boolean(issue.trashed_at) && (
              <p
                className="text-xs text-amber-500 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 leading-[1.7] mt-4 mb-[25px]"
                role="status"
              >
                In trash. Restore it by {day(issue.purge_after)} to keep it.
              </p>
            )}
            {Boolean(issue.archived_at) && (
              <p
                className="text-xs text-text-subtle bg-surface-2 p-3 rounded-xl border border-border leading-[1.7] mt-4 mb-[25px]"
                role="status"
              >
                This issue is archived and hidden from the active lists. Restore it to edit.
              </p>
            )}

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-text-subtle uppercase tracking-wider">Title</span>
              <input
                value={title}
                disabled={!!issue.archived_at}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-bg border border-border rounded-xl text-sm font-medium text-text-main focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent disabled:opacity-50"
              />
            </label>

            {aiQ.data?.enabled && (
              <div
                className="flex flex-wrap gap-2 items-center my-1.5 [&_input]:min-h-8 [&_select]:min-h-8"
                aria-label="AI assistance"
              >
                <button
                  type="button"
                  className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px] hover:text-text-main"
                  disabled={aiBusy}
                  onClick={() => runAi("summary")}
                >
                  Summarise with AI
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px] hover:text-text-main"
                  disabled={aiBusy}
                  onClick={() => runAi("triage")}
                >
                  Suggest priority
                </button>
              </div>
            )}

            {aiResult && (
              <p
                className="text-xs text-accent bg-accent/10 p-3 rounded-xl border border-accent/20 leading-[1.7] mt-4 mb-[25px]"
                role="status"
              >
                {aiResult}
              </p>
            )}

            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-text-subtle uppercase tracking-wider">
                Description
              </span>
              {str(issue.description) ? (
                <div className="p-3.5 bg-bg rounded-xl border border-border text-xs sm:text-sm text-text-main leading-relaxed mt-4 mb-[25px]">
                  <Markdown source={str(issue.description)} />
                </div>
              ) : (
                <p className="text-xs text-text-subtle italic p-3 bg-bg rounded-xl border border-border leading-[1.7] mt-4 mb-[25px]">
                  No description yet.
                </p>
              )}
            </div>

            {levelsQ.data && (levelsQ.data.levels.length > 0 || levelsQ.data.can_manage) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[13px]">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-text-subtle uppercase tracking-wider">
                    Security level
                  </span>
                  {levelsQ.data.can_manage ? (
                    <select
                      value={issueLevelQ.data?.level_id ?? ""}
                      onChange={(e) => setLevel.mutate(e.target.value || null)}
                      disabled={setLevel.isPending}
                      className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="">Open to the project</option>
                      {levelsQ.data.levels.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs sm:text-sm font-medium text-text-main block p-2 bg-surface-2 rounded-lg">
                      {issueLevelQ.data?.name ?? "Open to the project"}
                    </span>
                  )}
                </label>
              </div>
            )}

            {screenQ.data && screenQ.data.fields.length > 0 && (
              <p
                className="text-xs text-text-subtle bg-surface-2 p-2.5 rounded-lg border border-border"
                role="status"
              >
                This move shows{" "}
                {screenQ.data.fields
                  .map((k) => (fieldsQ.data ?? []).find((f) => f.key === k)?.label ?? k)
                  .join(", ")}
                .
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-text-subtle uppercase tracking-wider">
                  Status
                </span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                >
                  {(statusesQ.data ?? []).map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-text-subtle uppercase tracking-wider">
                  Priority
                </span>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer capitalize"
                >
                  {["low", "medium", "high", "urgent"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-text-subtle uppercase tracking-wider">Team</span>
                <select
                  value={str(issue.team_id)}
                  disabled={!!issue.archived_at}
                  onChange={async (e) => {
                    try {
                      await request(token, `/issues/${id}/team`, {
                        method: "PUT",
                        body: JSON.stringify({ team_id: e.target.value || null }),
                      });
                      await reload();
                      onChanged();
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer disabled:opacity-50"
                >
                  <option value="">No team</option>
                  {(teamsQ.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {visibleFields(fieldsQ.data ?? [], levelsQ.data?.can_manage ?? false).length > 0 && (
              <div className="border-t border-border pt-5 space-y-4 mt-[33px] [&_h3]:text-sm">
                <h3 className="text-sm font-semibold text-text-main">{t("drawer.fields")}</h3>
                <div className="space-y-3">
                  {visibleFields(fieldsQ.data ?? [], levelsQ.data?.can_manage ?? false).map((f) => {
                    const raw = values[f.key];
                    const disabled = !!issue.archived_at;
                    return (
                      <label
                        key={f.key}
                        className={
                          f.field_type === "boolean"
                            ? "check-row flex items-center gap-2 cursor-pointer"
                            : "block space-y-1"
                        }
                      >
                        <span className="text-xs font-semibold text-text-subtle">
                          {f.label}
                          {f.required ? " *" : ""}
                        </span>
                        {f.field_type === "boolean" ? (
                          <input
                            type="checkbox"
                            checked={raw === true}
                            disabled={disabled}
                            onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })}
                            className="rounded text-accent focus:ring-accent"
                          />
                        ) : f.field_type === "select" ? (
                          <select
                            value={displayValue(raw)}
                            disabled={disabled}
                            onChange={(e) => setValues({ ...values, [f.key]: e.target.value || null })}
                            className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                          >
                            <option value="">—</option>
                            {f.options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={
                              f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"
                            }
                            value={displayValue(raw)}
                            disabled={disabled}
                            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                            className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                className="px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-sm font-medium transition-colors shadow-sm disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)]"
                onClick={save}
                disabled={!!issue.archived_at}
              >
                Save issue
              </button>
              {issue.archived_at ? (
                <button
                  className="px-4 py-2 bg-surface-2 hover:bg-surface-3 border border-border text-text-main rounded-xl text-sm font-medium transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main"
                  onClick={() => lifecycle("restore")}
                >
                  {issue.trashed_at ? "Restore from trash" : "Restore issue"}
                </button>
              ) : (
                <>
                  <button
                    className="px-3.5 py-2 bg-surface-2 hover:bg-surface-3 border border-border text-text-main rounded-xl text-sm font-medium transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main"
                    onClick={() => lifecycle("archive")}
                  >
                    Archive issue
                  </button>
                  <button
                    className="ghost px-3.5 py-2 text-danger hover:bg-danger/10 rounded-xl text-sm font-medium transition-colors"
                    onClick={() => lifecycle("trash")}
                  >
                    Move to trash
                  </button>
                </>
              )}
            </div>

            <div className="border-t border-border pt-5 space-y-3 mt-[33px] [&_h3]:text-sm">
              <h3 className="text-sm font-semibold text-text-main">{t("drawer.connected")}</h3>
              <EntityRelations
                token={token}
                sourceType="issue"
                sourceId={id}
                projectId={str(issue.project_id)}
                targetType="page"
              />
            </div>

            <div className="border-t border-border pt-5 space-y-3 mt-[33px] [&_h3]:text-sm">
              <Attachments entityType="issue" entityId={id} canEdit />
            </div>

            <IssueDepth
              issue={{
                id,
                number: Number(issue.number),
                title: str(issue.title),
                project_id: str(issue.project_id),
              }}
              archived={!!issue.archived_at}
              onChanged={() => onChanged()}
            />

            <div className="border-t border-border pt-5 space-y-4 mt-[33px] [&_h3]:text-sm">
              <Reminders token={token} issueId={id} />
              <h3 className="text-sm font-semibold text-text-main">
                {t("drawer.discussion")} · {comments.length}
              </h3>
              <div className="space-y-3">
                {comments.map((c) => {
                  const commentId = str(c.id);
                  const mine = !!me && str(c.author_id) === me.user_id;
                  const isEditing = editing?.id === commentId;
                  const history = openHistory?.id === commentId ? openHistory.data : null;
                  return (
                    <div
                      className="p-3.5 bg-surface-2/60 border border-border rounded-xl space-y-2 border-b py-3.5 [&_b]:text-xs [&_small]:ml-2.5 [&_small]:text-text-subtle [&_p]:text-[13px] [&_p]:text-text-muted [&_p]:whitespace-pre-wrap [&_p]:my-[9px]"
                      key={commentId}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <b className="font-semibold text-text-main">{str(c.author)}</b>
                        <small className="text-text-subtle font-mono">
                          {day(c.created_at)}
                          {c.edited_at ? " · edited" : ""}
                        </small>
                      </div>
                      {isEditing ? (
                        <form onSubmit={saveEdit} className="space-y-2">
                          <label className="block">
                            <span className="sr-only">Edit comment</span>
                            <textarea
                              value={editing.text}
                              onChange={(e) => setEditing({ id: commentId, text: e.target.value })}
                              rows={3}
                              required
                              className="w-full p-2.5 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                          </label>
                          <div className="flex items-center gap-2">
                            <button className="px-3 py-1 bg-accent text-white rounded-lg text-xs font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] border border-border-strong hover:bg-surface-3 hover:text-text-main">
                              Save
                            </button>
                            <button
                              type="button"
                              className="ghost px-2.5 py-1 text-xs text-text-subtle hover:text-text-main"
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p className="text-xs sm:text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                          {str(c.body)}
                        </p>
                      )}
                      {!isEditing && <CommentReactions token={token} issueId={id} commentId={commentId} />}
                      {(mine || isAdmin) && !isEditing && (
                        <div className="flex items-center gap-2 pt-1 border-t border-border/40 my-1.5 [&_input]:min-h-8 [&_select]:min-h-8">
                          {mine && (
                            <button
                              type="button"
                              className="ghost text-xs text-text-subtle hover:text-accent font-medium min-h-[30px] px-2.5 py-1"
                              onClick={() => setEditing({ id: commentId, text: str(c.body) })}
                            >
                              Edit
                            </button>
                          )}
                          <button
                            type="button"
                            className="ghost text-xs text-text-subtle hover:text-accent font-medium min-h-[30px] px-2.5 py-1"
                            onClick={() => showHistory(commentId)}
                          >
                            {history ? "Hide history" : "History"}
                          </button>
                          <button
                            type="button"
                            className="ghost text-xs text-text-subtle hover:text-danger font-medium min-h-[30px] px-2.5 py-1"
                            onClick={() => deleteComment(commentId)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                      {history && (
                        <ol className="comment-history p-3 bg-surface border border-border rounded-xl text-xs space-y-2">
                          {history.revisions.map((r, n) => (
                            <li key={n} className="border-b border-border/50 pb-2">
                              <small className="text-text-subtle block font-mono">
                                {day(r.changed_at)} · {r.change === "delete" ? "deleted by" : "changed by"}{" "}
                                {r.changed_by}
                              </small>
                              <p className="mt-1 text-text-main">{r.body}</p>
                            </li>
                          ))}
                          <li>
                            <small className="text-text-subtle block font-mono">
                              {history.deleted ? "Deleted (text above)" : "Current"}
                            </small>
                            {!history.deleted && (
                              <p className="mt-1 text-text-main">{history.current_body}</p>
                            )}
                          </li>
                        </ol>
                      )}
                    </div>
                  );
                })}
              </div>
              <form onSubmit={comment} className="space-y-2 pt-2">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-text-subtle uppercase tracking-wider">
                    Add comment
                  </span>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={3}
                    required
                    placeholder="Write a comment…"
                    className="w-full p-3 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                  />
                </label>
                <button className="px-3.5 py-2 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs sm:text-sm font-medium text-text-main transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main">
                  Post comment
                </button>
              </form>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
