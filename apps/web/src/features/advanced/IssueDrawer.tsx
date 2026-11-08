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
  // Security level: who may see this issue. Project admins change it; everyone sees its name.
  const levelsQ = useQuery({
    queryKey: ["security-levels", projectId],
    queryFn: () =>
      request<{ can_manage: boolean; levels: { id: string; name: string }[] }>(token, `/projects/${projectId}/security-levels`),
    enabled: !!projectId,
  });
  const issueLevelQ = useQuery({
    queryKey: ["issue-security", id],
    queryFn: () => request<{ level_id: string | null; name: string | null }>(token, `/issues/${id}/security-level`),
    enabled: !!id,
  });
  const setLevel = useMutation({
    mutationFn: (levelId: string | null) => send(`/issues/${id}/security-level`, token, "PUT", { level_id: levelId }),
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
      request<{ fields: string[] }>(token, `/projects/${projectId}/transitions/${currentStatus}/${status}/screen`),
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
        // Field values are sent only once the project's definitions have loaded: an empty set would
        // clear every stored value.
        body: JSON.stringify({
          title,
          priority,
          status,
          ...(fieldsQ.isSuccess
            ? { custom_fields: toPayload(visibleFields(fieldsQ.data ?? [], levelsQ.data?.can_manage ?? false), values) }
            : {}),
        }),
      });
      await reload();
      onChanged();
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        // Someone else changed the issue. Load the latest version so the next save is based on it.
        await reload();
        setError("This issue changed while you were editing. The latest version is loaded; review it and save again.");
        return;
      }
      setError((e as Error).message);
    }
  };
  // Archive hides an issue from the active lists; trash does the same and keeps it restorable for 30 days.
  const lifecycle = async (action: "archive" | "trash" | "restore") => {
    if (action === "trash" && !window.confirm("Move this issue to trash? You can restore it for 30 days.")) return;
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
      setOpenHistory(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const deleteComment = async (commentId: string) => {
    if (!window.confirm("Delete this comment? Its text stays in the history for you and admins.")) return;
    try {
      await request(token, `/issues/${id}/comments/${commentId}`, { method: "DELETE" });
      setOpenHistory(null);
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
      className="drawer-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="issue-drawer" role="dialog" aria-modal="true" aria-label="Issue details">
        <div className="drawer-top">
          <b>{issue ? str(issue.kind).toUpperCase() + " · " + str(issue.number) : "Loading issue"}</b>
          <button
            type="button"
            className="favourite-toggle"
            aria-pressed={isFavourite}
            aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
            title={isFavourite ? "Remove from favourites" : "Add to favourites"}
            disabled={!issue || toggleFavourite.isPending}
            onClick={() => toggleFavourite.mutate()}
          >
            <Star size={18} fill={isFavourite ? "currentColor" : "none"} />
          </button>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {issue && (
          <>
            {issue.trashed_at && (
              <p className="drawer-description" role="status">
                In trash. Restore it by {day(issue.purge_after)} to keep it.
              </p>
            )}
            {issue.archived_at && (
              <p className="drawer-description" role="status">
                This issue is archived and hidden from the active lists. Restore it to edit.
              </p>
            )}
            <label>
              Title
              <input
                value={title}
                disabled={!!issue.archived_at}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            {str(issue.description) ? (
              <div className="drawer-description">
                <Markdown source={str(issue.description)} />
              </div>
            ) : (
              <p className="drawer-description">No description yet.</p>
            )}
            {levelsQ.data && (levelsQ.data.levels.length > 0 || levelsQ.data.can_manage) && (
              <div className="form-row">
                <label>
                  Security level
                  {levelsQ.data.can_manage ? (
                    <select
                      value={issueLevelQ.data?.level_id ?? ""}
                      onChange={(e) => setLevel.mutate(e.target.value || null)}
                      disabled={setLevel.isPending}
                    >
                      <option value="">Open to the project</option>
                      {levelsQ.data.levels.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{issueLevelQ.data?.name ?? "Open to the project"}</span>
                  )}
                </label>
              </div>
            )}
            {screenQ.data && screenQ.data.fields.length > 0 && (
              <p className="muted small" role="status">
                This move shows{" "}
                {screenQ.data.fields.map((k) => (fieldsQ.data ?? []).find((f) => f.key === k)?.label ?? k).join(", ")}
                .
              </p>
            )}
            <div className="form-row">
              <label>
                Status
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {(statusesQ.data ?? []).map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {["low", "medium", "high", "urgent"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                Team
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
                >
                  <option value="">No team (product backlog)</option>
                  {(teamsQ.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {visibleFields(fieldsQ.data ?? [], levelsQ.data?.can_manage ?? false).length > 0 && (
              <div className="drawer-section">
                <h3>{t("drawer.fields")}</h3>
                {visibleFields(fieldsQ.data ?? [], levelsQ.data?.can_manage ?? false).map((f) => {
                  const raw = values[f.key];
                  const disabled = !!issue.archived_at;
                  return (
                    <label key={f.key} className={f.field_type === "boolean" ? "check-row" : undefined}>
                      {f.label}
                      {f.required ? " *" : ""}
                      {f.field_type === "boolean" ? (
                        <input
                          type="checkbox"
                          checked={raw === true}
                          disabled={disabled}
                          onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })}
                        />
                      ) : f.field_type === "select" ? (
                        <select
                          value={displayValue(raw)}
                          disabled={disabled}
                          onChange={(e) => setValues({ ...values, [f.key]: e.target.value || null })}
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
                          type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                          value={displayValue(raw)}
                          disabled={disabled}
                          onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            <div className="drawer-actions">
              <button className="primary" onClick={save} disabled={!!issue.archived_at}>
                Save issue
              </button>
              {issue.archived_at ? (
                <button className="secondary" onClick={() => lifecycle("restore")}>
                  {issue.trashed_at ? "Restore from trash" : "Restore issue"}
                </button>
              ) : (
                <>
                  <button className="secondary" onClick={() => lifecycle("archive")}>
                    Archive issue
                  </button>
                  <button className="ghost" onClick={() => lifecycle("trash")}>
                    Move to trash
                  </button>
                </>
              )}
            </div>
            <div className="drawer-section">
              <h3>{t("drawer.connected")}</h3>
              <EntityRelations
                token={token}
                sourceType="issue"
                sourceId={id}
                projectId={str(issue.project_id)}
                targetType="page"
              />
            </div>
            <div className="drawer-section">
              <Attachments entityType="issue" entityId={id} canEdit />
            </div>
            <IssueDepth
              issue={{ id, number: Number(issue.number), title: str(issue.title), project_id: str(issue.project_id) }}
              archived={!!issue.archived_at}
              onChanged={() => onChanged()}
            />
            <div className="drawer-section">
              <Reminders token={token} issueId={id} />
              <h3>
                {t("drawer.discussion")} · {comments.length}
              </h3>
              {comments.map((c) => {
                const commentId = str(c.id);
                const mine = !!me && str(c.author_id) === me.user_id;
                const isEditing = editing?.id === commentId;
                const history = openHistory?.id === commentId ? openHistory.data : null;
                return (
                  <div className="comment" key={commentId}>
                    <b>{str(c.author)}</b>
                    <small>
                      {day(c.created_at)}
                      {c.edited_at ? " · edited" : ""}
                    </small>
                    {isEditing ? (
                      <form onSubmit={saveEdit}>
                        <label>
                          Edit comment
                          <textarea
                            value={editing.text}
                            onChange={(e) => setEditing({ id: commentId, text: e.target.value })}
                            rows={3}
                            required
                          />
                        </label>
                        <button className="secondary">Save</button>{" "}
                        <button type="button" className="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <p>{str(c.body)}</p>
                    )}
                    {!isEditing && <CommentReactions token={token} issueId={id} commentId={commentId} />}
                    {(mine || isAdmin) && !isEditing && (
                      <div className="row-actions">
                        {mine && (
                          <button
                            type="button"
                            className="ghost small-btn"
                            onClick={() => setEditing({ id: commentId, text: str(c.body) })}
                          >
                            Edit
                          </button>
                        )}
                        <button type="button" className="ghost small-btn" onClick={() => showHistory(commentId)}>
                          {history ? "Hide history" : "History"}
                        </button>
                        <button type="button" className="ghost small-btn" onClick={() => deleteComment(commentId)}>
                          Delete
                        </button>
                      </div>
                    )}
                    {history && (
                      <ol className="comment-history">
                        {history.revisions.map((r, n) => (
                          <li key={n}>
                            <small>
                              {day(r.changed_at)} · {r.change === "delete" ? "deleted by" : "changed by"} {r.changed_by}
                            </small>
                            <p>{r.body}</p>
                          </li>
                        ))}
                        <li>
                          <small>{history.deleted ? "Deleted (text above)" : "Current"}</small>
                          {!history.deleted && <p>{history.current_body}</p>}
                        </li>
                      </ol>
                    )}
                  </div>
                );
              })}
              <form onSubmit={comment}>
                <label>
                  Add comment
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} required />
                </label>
                <button className="secondary">Post comment</button>
              </form>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
