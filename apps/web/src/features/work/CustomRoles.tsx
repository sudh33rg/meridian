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
    <section
      className="mb-4 px-3.5 py-3 border border-border rounded-xl bg-surface-2 grid gap-2.5"
      aria-label="Custom roles"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b>Custom roles</b>
        <span className="text-text-subtle text-[11px]">
          A role gives its members the level it names, on top of their own. Project admins manage roles.
        </span>
      </div>
      <ul className="m-0 p-0 list-none grid gap-1.5">
        {rolesQ.data.map((r) => (
          <li
            key={r.id}
            className="grid grid-cols-[minmax(140px,1fr)_140px_auto_auto_auto] gap-1.5 items-center max-[640px]:flex max-[640px]:flex-wrap max-[640px]:gap-2 [&_input]:min-w-0 [&_input]:max-[640px]:flex-[1_1_120px] [&_select]:min-w-0 [&_select]:max-[640px]:flex-[1_1_120px]"
            style={{ flexWrap: "wrap" }}
          >
            <span>
              {r.name}{" "}
              <span className="text-text-subtle text-[11px]">· {LEVEL_LABEL[r.level] ?? r.level}</span>
            </span>
            <fieldset className="screen-fields" style={{ width: "100%" }}>
              <legend className="text-text-subtle text-[11px]">Members of {r.name}</legend>
              {(membersQ.data ?? []).map((m) => (
                <label
                  key={m.id}
                  className="inline-flex flex-row items-center gap-1.5 h-[30px] pl-2.5 pr-1 border border-dashed border-border-strong rounded-full text-xs text-text-subtle m-0 font-semibold [&_select]:border-0 [&_select]:bg-transparent [&_select]:text-inherit [&_select]:text-xs [&_select]:font-[650] [&_select]:py-1 [&_select]:pr-0 [&_select]:pl-1.5 [&_select]:max-w-[130px] [&_select]:cursor-pointer [&_select]:capitalize [&_select]:focus:outline-none [&_select]:focus:shadow-none"
                >
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
              className="inline-grid place-items-center rounded-lg p-[5px] text-text-subtle transition-colors hover:bg-surface-3 hover:text-text-main text-danger-text"
              aria-label={`Remove role ${r.name}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(r.id)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!rolesQ.data.length && <li className="text-text-subtle text-[11px]">No custom roles.</li>}
      </ul>
      <form
        className="flex flex-wrap gap-2 items-center [&_input]:min-w-[180px]"
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
        <button
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] rounded-[var(--radius)] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 text-[13px] bg-surface border border-border-strong text-text-muted hover:bg-surface-3 hover:text-text-main"
          type="submit"
          disabled={!name.trim() || create.isPending}
        >
          <Plus size={14} /> Add role
        </button>
      </form>
    </section>
  );
}
