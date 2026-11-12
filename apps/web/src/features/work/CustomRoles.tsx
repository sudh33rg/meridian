import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";

type Role = { id: string; name: string; level: number; member_ids: string[] };
type Member = { id: string; name: string };

const LEVEL_LABEL: Record<number, string> = { 1: "Viewer", 2: "Member", 3: "Admin" };

/** Custom project roles: a name, a level, and the members who hold it. Project admins manage them. */
export function CustomRoles({ token, projectId }: { token: string; projectId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [level, setLevel] = useState(2);
  const rolesQ = useQuery({
    queryKey: ["project-roles", projectId],
    queryFn: () => request<Role[]>(token, `/projects/${projectId}/roles`),
    enabled: !!projectId,
    retry: false,
  });
  const membersQ = useQuery({
    queryKey: ["members"],
    queryFn: () => request<Member[]>(token, "/members"),
    enabled: !!projectId && !!rolesQ.data,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["project-roles", projectId] });
  const fail = (e: unknown) => toast(errorMessage(e), { kind: "error" });
  const create = useMutation({
    mutationFn: () => send(`/projects/${projectId}/roles`, token, "POST", { name: name.trim(), level }),
    onSuccess: () => {
      setName("");
      toast("Role added");
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => send<void>(`/roles/${id}`, token, "DELETE"),
    onSuccess: () => {
      toast("Role removed");
      refresh();
    },
    onError: fail,
  });
  const setMembers = useMutation({
    mutationFn: ({ id, user_ids }: { id: string; user_ids: string[] }) =>
      send<void>(`/roles/${id}/members`, token, "PUT", { user_ids }),
    onSuccess: refresh,
    onError: fail,
  });
  if (!rolesQ.data) return null;
  return (
    <section className="workflow" aria-label="Custom roles">
      <div className="workflow-head">
        <b>Custom roles</b>
        <span className="muted small">
          A role gives its members the level it names, on top of their own. Project admins manage roles.
        </span>
      </div>
      <ul className="workflow-list">
        {rolesQ.data.map((r) => (
          <li key={r.id} className="workflow-row" style={{ flexWrap: "wrap" }}>
            <span>
              {r.name} <span className="muted small">· {LEVEL_LABEL[r.level] ?? r.level}</span>
            </span>
            <fieldset className="screen-fields" style={{ width: "100%" }}>
              <legend className="muted small">Members of {r.name}</legend>
              {(membersQ.data ?? []).map((m) => (
                <label key={m.id} className="filter-chip">
                  <input
                    type="checkbox"
                    checked={r.member_ids.includes(m.id)}
                    onChange={(e) =>
                      setMembers.mutate({
                        id: r.id,
                        user_ids: e.target.checked
                          ? [...r.member_ids, m.id]
                          : r.member_ids.filter((x) => x !== m.id),
                      })
                    }
                  />{" "}
                  {m.name}
                </label>
              ))}
            </fieldset>
            <button
              className="icon-btn danger"
              aria-label={`Remove role ${r.name}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(r.id)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!rolesQ.data.length && <li className="muted small">No custom roles.</li>}
      </ul>
      <form
        className="workflow-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input
          aria-label="Role name"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Role name"
        />
        <select aria-label="Role level" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
          <option value={1}>Viewer</option>
          <option value={2}>Member</option>
          <option value={3}>Admin</option>
        </select>
        <button className="secondary" type="submit" disabled={!name.trim() || create.isPending}>
          <Plus size={14} /> Add role
        </button>
      </form>
    </section>
  );
}
