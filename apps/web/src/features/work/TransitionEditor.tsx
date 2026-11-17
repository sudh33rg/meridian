import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { errorMessage, request, send } from "../../lib/api";
import type { FieldDefinition } from "../../lib/fields";
import type { ProjectStatus } from "../../lib/statuses";
import { useToast } from "../shared/Toast";
import { PostFunctionEditor } from "./PostFunctionEditor";

export type TransitionRule = {
  from: string;
  to: string;
  requires_field: string | null;
  requires_admin: boolean;
};

/** Which status changes the project allows. A status with no rules can move anywhere; once it has
 * rules, only the listed targets are allowed. A rule can also require a custom field to be filled. */
export function TransitionEditor({
  token,
  projectId,
  statuses,
}: {
  token: string;
  projectId: string;
  statuses: ProjectStatus[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [requires, setRequires] = useState("");
  const [adminOnly, setAdminOnly] = useState(false);
  const rulesQ = useQuery({
    queryKey: ["transitions", projectId],
    queryFn: () => request<TransitionRule[]>(token, `/projects/${projectId}/transitions`),
    enabled: !!projectId,
  });
  const fieldsQ = useQuery({
    queryKey: ["fields", projectId],
    queryFn: () => request<FieldDefinition[]>(token, `/projects/${projectId}/fields`),
    enabled: !!projectId,
  });
  const rules = rulesQ.data ?? [];
  const fail = (e: unknown) => toast(errorMessage(e), { kind: "error" });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["transitions", projectId] });
  const add = useMutation({
    mutationFn: () =>
      send<TransitionRule>(`/projects/${projectId}/transitions`, token, "POST", {
        from,
        to,
        requires_field: requires || null,
        requires_admin: adminOnly,
      }),
    onSuccess: () => {
      setFrom("");
      setTo("");
      setRequires("");
      setAdminOnly(false);
      toast("Workflow rule added");
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (r: TransitionRule) =>
      send<void>(`/projects/${projectId}/transitions/${r.from}/${r.to}`, token, "DELETE"),
    onSuccess: () => {
      toast("Workflow rule removed");
      refresh();
    },
    onError: fail,
  });
  const name = (key: string) => statuses.find((s) => s.key === key)?.name ?? key;
  const fieldLabel = (key: string) => (fieldsQ.data ?? []).find((f) => f.key === key)?.label ?? key;

  return (
    <section
      className="mb-4 px-3.5 py-3 border border-border rounded-xl bg-surface-2 grid gap-2.5"
      aria-label="Workflow rules"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b>Allowed moves</b>
        <span className="text-text-subtle text-[11px]">
          A status with no rules can move anywhere. Once it has rules, only the listed moves are allowed.
        </span>
      </div>
      <ul className="m-0 p-0 list-none grid gap-1.5">
        {rules.map((r) => (
          <li
            key={`${r.from}>${r.to}`}
            className="grid grid-cols-[minmax(140px,1fr)_140px_auto_auto_auto] gap-1.5 items-center max-[640px]:flex max-[640px]:flex-wrap max-[640px]:gap-2 [&_input]:min-w-0 [&_input]:max-[640px]:flex-[1_1_120px] [&_select]:min-w-0 [&_select]:max-[640px]:flex-[1_1_120px]"
          >
            <span>
              {name(r.from)} → {name(r.to)}
              {r.requires_field && (
                <span className="text-text-subtle text-[11px]"> · needs {fieldLabel(r.requires_field)}</span>
              )}
              {r.requires_admin && <span className="text-text-subtle text-[11px]"> · admins only</span>}
            </span>
            <button
              className="inline-grid place-items-center rounded-lg p-[5px] text-text-subtle transition-colors hover:bg-surface-3 hover:text-text-main text-danger-text"
              aria-label={`Remove move from ${name(r.from)} to ${name(r.to)}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(r)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!rules.length && !rulesQ.isLoading && (
          <li className="text-text-subtle text-[11px]">No rules: every move is allowed.</li>
        )}
      </ul>
      <form
        className="flex flex-wrap gap-2 items-center [&_input]:min-w-[180px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to) add.mutate();
        }}
      >
        <select aria-label="Move from" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">From…</option>
          {statuses.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
        <select aria-label="Move to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">To…</option>
          {statuses
            .filter((s) => s.key !== from)
            .map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
        </select>
        <select
          aria-label="Field that must be filled"
          value={requires}
          onChange={(e) => setRequires(e.target.value)}
        >
          <option value="">No field needed</option>
          {(fieldsQ.data ?? []).map((f) => (
            <option key={f.key} value={f.key}>
              Needs {f.label}
            </option>
          ))}
        </select>
        <label className="text-text-subtle text-[11px]">
          <input type="checkbox" checked={adminOnly} onChange={(e) => setAdminOnly(e.target.checked)} />{" "}
          Admins only
        </label>
        <button
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] rounded-[var(--radius)] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 text-[13px] bg-surface border border-border-strong text-text-muted hover:bg-surface-3 hover:text-text-main"
          type="submit"
          disabled={!from || !to || add.isPending}
        >
          <Plus size={14} /> Add move
        </button>
      </form>
      <PostFunctionEditor token={token} projectId={projectId} statuses={statuses} />
    </section>
  );
}
