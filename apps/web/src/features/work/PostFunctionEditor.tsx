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

/** The fields a move shows in its transition screen. Saved per move; the order is the project's field order. */
function ScreenFields({
  token,
  projectId,
  from,
  to,
  fields,
}: {
  token: string;
  projectId: string;
  from: string;
  to: string;
  fields: FieldDefinition[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const path = `/projects/${projectId}/transitions/${from}/${to}/screen`;
  const screenQ = useQuery({
    queryKey: ["transition-screen", projectId, from, to],
    queryFn: () => request<{ fields: string[] }>(token, path),
  });
  const saved = screenQ.data?.fields ?? [];
  const [draft, setDraft] = useState<string[] | null>(null);
  const shown = draft ?? saved;
  const save = useMutation({
    mutationFn: () => send<{ fields: string[] }>(path, token, "PUT", { fields: shown }),
    onSuccess: () => {
      setDraft(null);
      toast("Transition screen saved");
      void qc.invalidateQueries({ queryKey: ["transition-screen", projectId, from, to] });
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });
  const toggle = (key: string) =>
    setDraft(
      shown.includes(key)
        ? shown.filter((k) => k !== key)
        : fields.map((f) => f.key).filter((k) => shown.includes(k) || k === key),
    );
  return (
    <fieldset className="screen-fields">
      <legend className="text-text-subtle text-[11px]">Fields shown when this move is made</legend>
      {!fields.length && <p className="text-text-subtle text-[11px]">Define custom fields first.</p>}
      {fields.map((f) => (
        <label
          key={f.key}
          className="inline-flex flex-row items-center gap-1.5 h-[30px] pl-2.5 pr-1 border border-dashed border-border-strong rounded-full text-xs text-text-subtle m-0 font-semibold [&_select]:border-0 [&_select]:bg-transparent [&_select]:text-inherit [&_select]:text-xs [&_select]:font-[650] [&_select]:py-1 [&_select]:pr-0 [&_select]:pl-1.5 [&_select]:max-w-[130px] [&_select]:cursor-pointer [&_select]:capitalize [&_select]:focus:outline-none [&_select]:focus:shadow-none"
        >
          <input type="checkbox" checked={shown.includes(f.key)} onChange={() => toggle(f.key)} /> {f.label}
        </label>
      ))}
      {draft && (
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] rounded-[var(--radius)] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 text-[13px] bg-accent text-on-accent shadow-[var(--shadow-sm)] hover:bg-accent-strong"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          Save screen
        </button>
      )}
    </fieldset>
  );
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
        body.value = fieldValue(
          fields.find((f) => f.key === field),
          text,
        );
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
    <section
      className="mb-4 px-3.5 py-3 border border-border rounded-xl bg-surface-2 grid gap-2.5"
      aria-label="Post-functions"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b>Post-functions</b>
        <span className="text-text-subtle text-[11px]">
          Run in the same transaction as the status change. If one fails, the move is refused.
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center [&_input]:min-w-[180px]">
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
          <ul className="m-0 p-0 list-none grid gap-1.5">
            {actions.map((a) => (
              <li
                key={a.id}
                className="grid grid-cols-[minmax(140px,1fr)_140px_auto_auto_auto] gap-1.5 items-center max-[640px]:flex max-[640px]:flex-wrap max-[640px]:gap-2 [&_input]:min-w-0 [&_input]:max-[640px]:flex-[1_1_120px] [&_select]:min-w-0 [&_select]:max-[640px]:flex-[1_1_120px]"
              >
                <span>{describe(a)}</span>
                <button
                  className="inline-grid place-items-center rounded-lg p-[5px] text-text-subtle transition-colors hover:bg-surface-3 hover:text-text-main text-danger-text"
                  aria-label={`Remove post-function ${describe(a)}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(a.id)}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
            {!actions.length && !actionsQ.isLoading && (
              <li className="text-text-subtle text-[11px]">No post-functions on this move.</li>
            )}
          </ul>
          <ScreenFields token={token} projectId={projectId} from={from} to={to} fields={fields} />
          <form
            className="flex flex-wrap gap-2 items-center [&_input]:min-w-[180px]"
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
            <button
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] rounded-[var(--radius)] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 text-[13px] bg-surface border border-border-strong text-text-muted hover:bg-surface-3 hover:text-text-main"
              type="submit"
              disabled={add.isPending}
            >
              <Plus size={14} /> Add post-function
            </button>
          </form>
        </>
      )}
    </section>
  );
}
