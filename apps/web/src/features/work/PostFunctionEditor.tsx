import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { errorMessage, request, send } from "../../lib/api";
import type { FieldDefinition } from "../../lib/fields";
import type { ProjectStatus } from "../../lib/statuses";
import { useToast } from "../shared/Toast";

type PostFunction = {
  id: string;
  action: "set_field" | "notify_admins" | "notify_assignee" | "create_subtask";
  field: string | null;
  value: unknown;
  title: string | null;
};

const ACTION_LABEL: Record<PostFunction["action"], string> = {
  set_field: "Set a field",
  notify_admins: "Notify admins and owners",
  notify_assignee: "Notify the assignee",
  create_subtask: "Create a subtask",
};

/** Parses what the user typed for a field into the type the field stores. */
function fieldValue(def: FieldDefinition | undefined, raw: string): unknown {
  if (!def) return raw;
  if (def.field_type === "number") return Number(raw);
  if (def.field_type === "boolean") return raw === "true";
  return raw;
}

/** Post-functions of one allowed move: actions that run in the same transaction as the status change. */
export function PostFunctionEditor({
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
  const [action, setAction] = useState<PostFunction["action"]>("notify_assignee");
  const [field, setField] = useState("");
  const [text, setText] = useState("");
  const fieldsQ = useQuery({
    queryKey: ["fields", projectId],
    queryFn: () => request<FieldDefinition[]>(token, `/projects/${projectId}/fields`),
    enabled: !!projectId,
  });
  const base = `/projects/${projectId}/transitions/${from}/${to}/actions`;
  const actionsQ = useQuery({
    queryKey: ["transition-actions", projectId, from, to],
    queryFn: () => request<PostFunction[]>(token, base),
    enabled: !!projectId && !!from && !!to,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["transition-actions", projectId, from, to] });
  const fail = (e: unknown) => toast(errorMessage(e), { kind: "error" });
  const fields = fieldsQ.data ?? [];

  const add = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { action };
      if (action === "set_field") {
        body.field = field;
        body.value = fieldValue(fields.find((f) => f.key === field), text);
      }
      if (action === "create_subtask") body.value = text.trim();
      return send<PostFunction>(base, token, "POST", body);
    },
    onSuccess: () => {
      setText("");
      toast("Post-function added");
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => send<void>(`${base}/${id}`, token, "DELETE"),
    onSuccess: () => {
      toast("Post-function removed");
      refresh();
    },
    onError: fail,
  });

  const actions = actionsQ.data ?? [];
  const describe = (a: PostFunction) =>
    a.action === "set_field"
      ? `Set ${fields.find((f) => f.key === a.field)?.label ?? a.field} to ${String(a.value)}`
      : a.action === "create_subtask"
        ? `Create subtask “${a.title ?? ""}”`
        : ACTION_LABEL[a.action];
  const ready = !!from && !!to && from !== to;

  return (
    <section className="workflow" aria-label="Post-functions">
      <div className="workflow-head">
        <b>Post-functions</b>
        <span className="muted small">
          Run in the same transaction as the status change. If one fails, the move is refused.
        </span>
      </div>
      <div className="workflow-add">
        <select aria-label="Post-function move from" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">From…</option>
          {statuses.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
        <select aria-label="Post-function move to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">To…</option>
          {statuses
            .filter((s) => s.key !== from)
            .map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
        </select>
      </div>
      {ready && (
        <>
          <ul className="workflow-list">
            {actions.map((a) => (
              <li key={a.id} className="workflow-row">
                <span>{describe(a)}</span>
                <button
                  className="icon-btn danger"
                  aria-label={`Remove post-function ${describe(a)}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(a.id)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
            {!actions.length && !actionsQ.isLoading && (
              <li className="muted small">No post-functions on this move.</li>
            )}
          </ul>
          <form
            className="workflow-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (action === "set_field" && !field) return;
              if (action === "create_subtask" && !text.trim()) return;
              add.mutate();
            }}
          >
            <select
              aria-label="Post-function action"
              value={action}
              onChange={(e) => setAction(e.target.value as PostFunction["action"])}
            >
              {(Object.keys(ACTION_LABEL) as PostFunction["action"][]).map((k) => (
                <option key={k} value={k}>
                  {ACTION_LABEL[k]}
                </option>
              ))}
            </select>
            {action === "set_field" && (
              <>
                <select aria-label="Field to set" value={field} onChange={(e) => setField(e.target.value)}>
                  <option value="">Field…</option>
                  {fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Value to set"
                  value={text}
                  maxLength={255}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Value"
                />
              </>
            )}
            {action === "create_subtask" && (
              <input
                aria-label="Subtask title"
                value={text}
                maxLength={255}
                onChange={(e) => setText(e.target.value)}
                placeholder="Subtask title"
              />
            )}
            <button className="secondary" type="submit" disabled={add.isPending}>
              <Plus size={14} /> Add post-function
            </button>
          </form>
        </>
      )}
    </section>
  );
}
