import React, { useEffect, useState } from "react";
import { EntityRelations } from "./EntityRelations";
import { X } from "lucide-react";
import { request } from "../../lib/api";
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
  const reload = async () => {
    try {
      const [i, c] = await Promise.all([
        request<Item>(token, `/issues/${id}/details`),
        request<Item[]>(token, `/issues/${id}/comments`),
      ]);
      setIssue(i);
      setTitle(str(i.title));
      setPriority(str(i.priority));
      setStatus(str(i.status));
      setComments(c);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void reload();
  }, [id, token]);
  const save = async () => {
    try {
      await request(token, `/issues/${id}/edit`, {
        method: "PATCH",
        body: JSON.stringify({ title, priority, status }),
      });
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
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <p className="drawer-description">{str(issue.description) || "No description yet."}</p>
            <div className="form-row">
              <label>
                Status
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {["todo", "in_progress", "in_review", "done"].map((x) => (
                    <option key={x} value={x}>
                      {x.replaceAll("_", " ")}
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
            <button className="primary" onClick={save}>
              Save issue
            </button>
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
