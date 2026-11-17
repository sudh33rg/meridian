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
    <div className="inline-comments-drawer w-full sm:w-96 bg-surface border-l border-border flex flex-col h-full p-4 shrink-0 shadow-lg">
      <div className="flex justify-between items-center mb-4 pb-2 border-b border-border">
        <h4 className="flex items-center gap-2 text-sm sm:text-base font-bold text-text truncate">
          <MessageSquare size={18} className="text-accent shrink-0" />
          <span className="truncate">Inline Comments: {pageTitle}</span>
        </h4>
        <button
          className="icon-ghost p-1.5 rounded-lg text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
          onClick={onClose}
          aria-label="Close inline comments"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex justify-between items-center gap-2 mb-3">
        <button
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] text-text-muted hover:text-text-main"
          onClick={() => setFilterResolved((v) => !v)}
        >
          {filterResolved ? "View Open Threads" : "View Resolved"}
        </button>
        <button
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-strong transition-colors cursor-pointer justify-center whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] shadow-[var(--shadow-sm)]"
          onClick={() => setAdding((v) => !v)}
        >
          <Plus size={14} /> {adding ? "Cancel" : "Add Comment"}
        </button>
      </div>

      {adding && (
        <form
          onSubmit={addComment}
          className="bg-surface-2 p-3 rounded-xl border border-border space-y-3 mb-4"
        >
          <label className="block text-xs font-medium text-text space-y-1">
            <span>Highlighted Text Reference</span>
            <input
              type="text"
              placeholder="Quote the text you are discussing"
              value={highlightedText}
              onChange={(e) => setHighlightedText(e.target.value)}
              required
              className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface text-text text-xs focus:outline-hidden focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="block text-xs font-medium text-text space-y-1">
            <span>Your Comment</span>
            <textarea
              rows={2}
              placeholder="Write inline feedback..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              required
              className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface text-text text-xs focus:outline-hidden focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="px-2.5 py-1 rounded-md text-xs font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] text-text-muted hover:text-text-main"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1 rounded-md text-xs font-semibold text-on-accent bg-accent hover:bg-accent-strong transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px] shadow-[var(--shadow-sm)]"
              disabled={!highlightedText.trim() || !newComment.trim()}
            >
              Post
            </button>
          </div>
        </form>
      )}

      {comments.isLoading && <p className="text-xs text-muted">Loading inline comments…</p>}

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {list.map((c) => (
          <div
            key={c.id}
            className={`border border-border rounded-xl p-3 space-y-2 transition-colors ${
              c.resolved ? "bg-surface-2/60 opacity-80" : "bg-surface shadow-xs"
            }`}
          >
            <div className="border-l-2 border-accent pl-2.5 text-xs text-muted italic">
              “{c.highlighted_text}”
            </div>
            <div className="text-xs sm:text-sm font-medium text-text">{c.comment}</div>
            <div className="flex justify-between items-center text-[11px] text-muted pt-2 border-t border-border">
              <span>
                {c.author_name} · {formatDateTime(c.created_at)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  className="icon-ghost p-1 rounded hover:bg-surface-2 transition-colors cursor-pointer"
                  onClick={() => toggleResolved(c.id, c.resolved)}
                  title={c.resolved ? "Reopen thread" : "Resolve thread"}
                  aria-label="Toggle resolved"
                >
                  <CheckCircle size={14} className={c.resolved ? "text-success" : "text-muted"} />
                </button>
                <button
                  className="icon-ghost p-1 rounded hover:bg-surface-2 text-muted hover:text-danger transition-colors cursor-pointer"
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
          <p className="text-xs text-muted text-center py-8">
            {filterResolved ? "No resolved inline threads." : "No active inline comments."}
          </p>
        )}
      </div>
    </div>
  );
}
