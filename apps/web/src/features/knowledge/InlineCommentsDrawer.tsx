import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, send, errorMessage } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { useToast } from "../shared/Toast";
import { formatDateTime } from "../../lib/datetime";
import { MessageSquare, CheckCircle, Trash2, Plus, X } from "lucide-react";

export type PageInlineComment = {
  id: string;
  page_id: string;
  author_id: string;
  author_name: string;
  highlighted_text: string;
  comment: string;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export function InlineCommentsDrawer({
  pageId,
  pageTitle,
  onClose,
}: {
  pageId: string;
  pageTitle: string;
  onClose: () => void;
}) {
  const { session, setError } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filterResolved, setFilterResolved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [highlightedText, setHighlightedText] = useState("");
  const [newComment, setNewComment] = useState("");

  const comments = useQuery({
    queryKey: ["inline-comments", pageId],
    queryFn: () => request<PageInlineComment[]>(session.token, `/pages/${pageId}/inline-comments`),
  });

  const addComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!highlightedText.trim() || !newComment.trim()) return;
    try {
      await send(`/pages/${pageId}/inline-comments`, session.token, "POST", {
        highlighted_text: highlightedText.trim(),
        comment: newComment.trim(),
      });
      setHighlightedText("");
      setNewComment("");
      setAdding(false);
      toast("Inline comment posted");
      await qc.invalidateQueries({ queryKey: ["inline-comments", pageId] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const toggleResolved = async (id: string, currentResolved: boolean) => {
    try {
      await send(`/pages/${pageId}/inline-comments/${id}`, session.token, "PATCH", {
        resolved: !currentResolved,
      });
      toast(currentResolved ? "Thread reopened" : "Thread resolved");
      await qc.invalidateQueries({ queryKey: ["inline-comments", pageId] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const deleteComment = async (id: string) => {
    try {
      await send(`/pages/${pageId}/inline-comments/${id}`, session.token, "DELETE");
      toast("Comment deleted");
      await qc.invalidateQueries({ queryKey: ["inline-comments", pageId] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const list = (comments.data ?? []).filter((c) => (filterResolved ? c.resolved : !c.resolved));

  return (
    <div
      className="inline-comments-drawer"
      style={{
        width: 360,
        background: "var(--bg)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h4 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <MessageSquare size={18} /> Inline Comments: {pageTitle}
        </h4>
        <button className="icon-ghost" onClick={onClose} aria-label="Close inline comments">
          <X size={18} />
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button
          className="secondary small-btn"
          onClick={() => setFilterResolved((v) => !v)}
        >
          {filterResolved ? "View Open Threads" : "View Resolved"}
        </button>
        <button className="primary small-btn" onClick={() => setAdding((v) => !v)}>
          <Plus size={14} /> {adding ? "Cancel" : "Add Comment"}
        </button>
      </div>

      {adding && (
        <form onSubmit={addComment} style={{ background: "var(--bg-subtle)", padding: 12, borderRadius: 6, marginBottom: 16 }}>
          <label className="small" style={{ display: "block", marginBottom: 8 }}>
            Highlighted Text Reference
            <input
              type="text"
              placeholder="Quote the text you are discussing"
              value={highlightedText}
              onChange={(e) => setHighlightedText(e.target.value)}
              required
              style={{ width: "100%" }}
            />
          </label>
          <label className="small" style={{ display: "block", marginBottom: 12 }}>
            Your Comment
            <textarea
              rows={2}
              placeholder="Write inline feedback..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              required
              style={{ width: "100%" }}
            />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="secondary small-btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="primary small-btn" disabled={!highlightedText.trim() || !newComment.trim()}>
              Post
            </button>
          </div>
        </form>
      )}

      {comments.isLoading && <p className="muted small">Loading inline comments…</p>}

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        {list.map((c) => (
          <div
            key={c.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 10,
              background: c.resolved ? "var(--bg-subtle)" : "var(--bg)",
            }}
          >
            <div
              style={{
                borderLeft: "3px solid #3b82f6",
                paddingLeft: 8,
                marginBottom: 8,
                fontSize: 12,
                color: "var(--muted)",
                fontStyle: "italic",
              }}
            >
              “{c.highlighted_text}”
            </div>
            <div style={{ fontSize: 13, marginBottom: 6 }}>{c.comment}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }} className="muted">
              <span>{c.author_name} · {formatDateTime(c.created_at)}</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  className="icon-ghost"
                  onClick={() => toggleResolved(c.id, c.resolved)}
                  title={c.resolved ? "Reopen thread" : "Resolve thread"}
                  aria-label="Toggle resolved"
                >
                  <CheckCircle size={14} color={c.resolved ? "#10b981" : "currentColor"} />
                </button>
                <button
                  className="icon-ghost"
                  onClick={() => deleteComment(c.id)}
                  title="Delete comment"
                  aria-label="Delete comment"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && !comments.isLoading && (
          <p className="muted small" style={{ textAlign: "center", margin: "24px 0" }}>
            {filterResolved ? "No resolved inline threads." : "No active inline comments."}
          </p>
        )}
      </div>
    </div>
  );
}
