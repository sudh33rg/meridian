import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Trash2 } from "lucide-react";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";

/** The reactions a member can add to a comment, in display order. */
const REACTIONS: { key: string; glyph: string; label: string }[] = [
  { key: "thumbs_up", glyph: "👍", label: "Thumbs up" },
  { key: "party", glyph: "🎉", label: "Celebrate" },
  { key: "eyes", glyph: "👀", label: "Looking" },
  { key: "heart", glyph: "❤️", label: "Love" },
  { key: "rocket", glyph: "🚀", label: "Ship it" },
  { key: "check", glyph: "✅", label: "Done" },
];

type CommentReaction = { comment_id: string; reaction: string; count: number; mine: boolean };
type Reminder = { id: string; remind_at: string; note: string; sent_at: string | null };

/** Reaction buttons under one comment. Counts come from the issue's reactions list. */
export function CommentReactions({
  token,
  issueId,
  commentId,
}: {
  token: string;
  issueId: string;
  commentId: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const reactionsQ = useQuery({
    queryKey: ["reactions", issueId],
    queryFn: () => request<CommentReaction[]>(token, `/issues/${issueId}/reactions`),
  });
  const toggle = useMutation({
    mutationFn: ({ reaction, on }: { reaction: string; on: boolean }) =>
      send<void>(`/comments/${commentId}/reactions/${reaction}`, token, on ? "DELETE" : "PUT"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["reactions", issueId] }),
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });
  const rows = (reactionsQ.data ?? []).filter((r) => r.comment_id === commentId);
  return (
    <div className="reactions" role="group" aria-label="Reactions">
      {REACTIONS.map((r) => {
        const row = rows.find((x) => x.reaction === r.key);
        const count = row?.count ?? 0;
        const on = !!row?.mine;
        return (
          <button
            key={r.key}
            type="button"
            className={
              "text-xs bg-surface-2 border border-border text-text-main rounded-full px-2.5 py-[3px] max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer" +
              (on ? " on" : "")
            }
            aria-pressed={on}
            aria-label={`${r.label}, ${count}`}
            title={r.label}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate({ reaction: r.key, on })}
          >
            <span aria-hidden="true">{r.glyph}</span> {count > 0 ? count : ""}
          </button>
        );
      })}
    </div>
  );
}

/** The current member's reminders on an issue. Each one becomes a notification when it is due. */
export function Reminders({ token, issueId }: { token: string; issueId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const remindersQ = useQuery({
    queryKey: ["reminders", issueId],
    queryFn: () => request<Reminder[]>(token, `/issues/${issueId}/reminders`),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["reminders", issueId] });
  const add = useMutation({
    mutationFn: () =>
      send<Reminder>(`/issues/${issueId}/reminders`, token, "POST", {
        remind_at: new Date(when).toISOString(),
        note: note.trim(),
      }),
    onSuccess: () => {
      setWhen("");
      setNote("");
      toast("Reminder set");
      refresh();
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => send<void>(`/reminders/${id}`, token, "DELETE"),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });
  const list = remindersQ.data ?? [];
  return (
    <section className="mt-[33px] border-t border-border pt-[23px] [&_h3]:text-sm" aria-label="Reminders">
      <h3>Reminders</h3>
      {list.length === 0 && (
        <p className="text-text-subtle text-[11px]">No reminders on this issue for you.</p>
      )}
      <ul className="m-0 p-0 list-none grid gap-1.5">
        {list.map((r) => (
          <li
            key={r.id}
            className="grid grid-cols-[minmax(140px,1fr)_140px_auto_auto_auto] gap-1.5 items-center max-[640px]:flex max-[640px]:flex-wrap max-[640px]:gap-2 [&_input]:min-w-0 [&_input]:max-[640px]:flex-[1_1_120px] [&_select]:min-w-0 [&_select]:max-[640px]:flex-[1_1_120px]"
          >
            <span>
              <Bell size={13} aria-hidden="true" /> {new Date(r.remind_at).toLocaleString()}
              {r.note && <span className="text-text-subtle text-[11px]"> · {r.note}</span>}
              {r.sent_at && <span className="text-text-subtle text-[11px]"> · sent</span>}
            </span>
            <button
              className="inline-grid place-items-center rounded-lg p-[5px] text-text-subtle transition-colors hover:bg-surface-3 hover:text-text-main text-danger-text"
              aria-label="Remove reminder"
              disabled={remove.isPending}
              onClick={() => remove.mutate(r.id)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="inline-flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (when) add.mutate();
        }}
      >
        <input
          type="datetime-local"
          aria-label="Remind me at"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <input
          aria-label="Reminder note"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
        />
        <button
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] rounded-[var(--radius)] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 text-[13px] bg-surface border border-border-strong text-text-muted hover:bg-surface-3 hover:text-text-main"
          type="submit"
          disabled={!when || add.isPending}
        >
          Add reminder
        </button>
      </form>
    </section>
  );
}
