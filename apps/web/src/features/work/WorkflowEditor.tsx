import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { errorMessage, send } from "../../lib/api";
import { CATEGORY_LABEL, type ProjectStatus, type StatusCategory } from "../../lib/statuses";
import { useToast } from "../shared/Toast";

const CATEGORIES = Object.keys(CATEGORY_LABEL) as StatusCategory[];

/** Board columns for a project. Keys never change; names, categories and order can. Only project
 * admins can change them; the server refuses other members, and the message says so. */
export function WorkflowEditor({
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
  const [name, setName] = useState("");
  const [category, setCategory] = useState<StatusCategory>("in_progress");
  const refresh = () => qc.invalidateQueries({ queryKey: ["statuses", projectId] });
  const fail = (e: unknown) => toast(errorMessage(e), { kind: "error" });

  const change = useMutation({
    mutationFn: ({ key, body }: { key: string; body: Record<string, unknown> }) =>
      send<ProjectStatus>(`/projects/${projectId}/statuses/${key}`, token, "PATCH", body),
    onSuccess: () => void refresh(),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (key: string) => send<void>(`/projects/${projectId}/statuses/${key}`, token, "DELETE"),
    onSuccess: () => {
      toast("Status deleted");
      void refresh();
    },
    onError: fail,
  });
  const add = useMutation({
    mutationFn: () =>
      send<ProjectStatus>(`/projects/${projectId}/statuses`, token, "POST", { name: name.trim(), category }),
    onSuccess: (s) => {
      setName("");
      toast(`Added “${s.name}”`);
      void refresh();
    },
    onError: fail,
  });

  return (
    <section className="workflow" aria-label="Workflow statuses">
      <div className="workflow-head">
        <b>Workflow</b>
        <span className="muted small">
          Done-category issues count as completed. Renaming a status keeps its issues.
        </span>
      </div>
      <ol className="workflow-list">
        {statuses.map((s, index) => (
          <li key={s.key} className="workflow-row">
            <input
              aria-label={`Name of ${s.key}`}
              defaultValue={s.name}
              key={`${s.key}-${s.name}`}
              maxLength={40}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== s.name) change.mutate({ key: s.key, body: { name: value } });
                else e.target.value = s.name;
              }}
            />
            <input
              type="number"
              min={1}
              max={1000}
              aria-label={`WIP limit of ${s.name}`}
              title="Work-in-progress limit: moves into this column stop at this many issues. Empty for none."
              placeholder="No limit"
              defaultValue={s.wip_limit == null ? "" : String(s.wip_limit)}
              key={`${s.key}-wip-${s.wip_limit ?? "none"}`}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const next = raw === "" ? null : Number(raw);
                if (next !== null && (!Number.isInteger(next) || next < 1 || next > 1000)) {
                  toast("A WIP limit is a whole number from 1 to 1000, or empty", { kind: "error" });
                  e.target.value = s.wip_limit == null ? "" : String(s.wip_limit);
                  return;
                }
                if (next !== (s.wip_limit ?? null)) {
                  void send(`/projects/${projectId}/statuses/${s.key}/wip-limit`, token, "PUT", { limit: next })
                    .then(() => refresh())
                    .catch(fail);
                }
              }}
            />
            <select
              aria-label={`Category of ${s.name}`}
              value={s.category}
              onChange={(e) => change.mutate({ key: s.key, body: { category: e.target.value } })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <button
              className="icon-btn"
              aria-label={`Move ${s.name} left`}
              disabled={index === 0 || change.isPending}
              onClick={() => change.mutate({ key: s.key, body: { position: index - 1 } })}
            >
              <ArrowUp size={14} />
            </button>
            <button
              className="icon-btn"
              aria-label={`Move ${s.name} right`}
              disabled={index === statuses.length - 1 || change.isPending}
              onClick={() => change.mutate({ key: s.key, body: { position: index + 1 } })}
            >
              <ArrowDown size={14} />
            </button>
            <button
              className="icon-btn danger"
              aria-label={`Delete ${s.name}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(s.key)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ol>
      <form
        className="workflow-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <input
          aria-label="New status name"
          placeholder="New status"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          aria-label="New status category"
          value={category}
          onChange={(e) => setCategory(e.target.value as StatusCategory)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <button className="secondary" type="submit" disabled={!name.trim() || add.isPending}>
          <Plus size={14} /> Add status
        </button>
      </form>
    </section>
  );
}
