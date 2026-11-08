import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { errorMessage, request, send } from "../../lib/api";
import type { FieldDefinition } from "../../lib/fields";
import type { ProjectStatus } from "../../lib/statuses";
import { useToast } from "../shared/Toast";

export type TransitionRule = { from: string; to: string; requires_field: string | null };

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
      }),
    onSuccess: () => {
      setFrom("");
      setTo("");
      setRequires("");
      toast("Workflow rule added");
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (r: TransitionRule) => send<void>(`/projects/${projectId}/transitions/${r.from}/${r.to}`, token, "DELETE"),
    onSuccess: () => {
      toast("Workflow rule removed");
      refresh();
    },
    onError: fail,
  });
  const name = (key: string) => statuses.find((s) => s.key === key)?.name ?? key;
  const fieldLabel = (key: string) => (fieldsQ.data ?? []).find((f) => f.key === key)?.label ?? key;

  return (
    <section className="workflow" aria-label="Workflow rules">
      <div className="workflow-head">
        <b>Allowed moves</b>
        <span className="muted small">
          A status with no rules can move anywhere. Once it has rules, only the listed moves are allowed.
        </span>
      </div>
      <ul className="workflow-list">
        {rules.map((r) => (
          <li key={`${r.from}>${r.to}`} className="workflow-row">
            <span>
              {name(r.from)} → {name(r.to)}
              {r.requires_field && <span className="muted small"> · needs {fieldLabel(r.requires_field)}</span>}
            </span>
            <button
              className="icon-btn danger"
              aria-label={`Remove move from ${name(r.from)} to ${name(r.to)}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(r)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!rules.length && !rulesQ.isLoading && <li className="muted small">No rules: every move is allowed.</li>}
      </ul>
      <form
        className="workflow-add"
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
        <select aria-label="Field that must be filled" value={requires} onChange={(e) => setRequires(e.target.value)}>
          <option value="">No field needed</option>
          {(fieldsQ.data ?? []).map((f) => (
            <option key={f.key} value={f.key}>
              Needs {f.label}
            </option>
          ))}
        </select>
        <button className="secondary" type="submit" disabled={!from || !to || add.isPending}>
          <Plus size={14} /> Add move
        </button>
      </form>
    </section>
  );
}
