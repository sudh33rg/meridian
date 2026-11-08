import React, { useCallback, useEffect, useRef, useState } from "react";
import { EntityRelations } from "./EntityRelations";
import { Attachments } from "../shared/Attachments";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, request, requestWithHeaders } from "../../lib/api";
import type { ProjectStatus } from "../../lib/statuses";
import type { Item } from "../../lib/types";
import { str, day } from "./shared";

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
    [error, setError] = useState("");
  // The ETag of the issue as last loaded; sent back as If-Match so a stale save is refused.
  const etag = useRef<string | null>(null);
  // The issue's project defines which statuses it can take.
  const projectId = issue ? str(issue.project_id) : "";
  const statusesQ = useQuery({
    queryKey: ["statuses", projectId],
    queryFn: () => request<ProjectStatus[]>(token, `/projects/${projectId}/statuses`),
    enabled: !!projectId,
  });
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
      setComments(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, token]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const save = async () => {
    try {
      await request(token, `/issues/${id}/edit`, {
        method: "PATCH",
        headers: etag.current ? { "If-Match": etag.current } : {},
        body: JSON.stringify({ title, priority, status }),
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
  const archiveToggle = async () => {
    const archived = !!issue?.archived_at;
    try {
      await request(token, `/issues/${id}/${archived ? "unarchive" : "archive"}`, { method: "POST" });
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
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {issue && (
          <>
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
            <p className="drawer-description">{str(issue.description) || "No description yet."}</p>
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
            </div>
            <div className="drawer-actions">
              <button className="primary" onClick={save} disabled={!!issue.archived_at}>
                Save issue
              </button>
              <button className="secondary" onClick={archiveToggle}>
                {issue.archived_at ? "Restore issue" : "Archive issue"}
              </button>
            </div>
            <div className="drawer-section">
              <h3>Connected knowledge</h3>
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
            <div className="drawer-section">
              <h3>Discussion · {comments.length}</h3>
              {comments.map((c) => (
                <div className="comment" key={str(c.id)}>
                  <b>{str(c.author)}</b>
                  <small>{day(c.created_at)}</small>
                  <p>{str(c.body)}</p>
                </div>
              ))}
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
