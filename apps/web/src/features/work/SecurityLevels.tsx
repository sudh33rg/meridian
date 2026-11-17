import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";

type Level = { id: string; name: string; description: string; member_ids: string[] };
type Levels = { can_manage: boolean; levels: Level[] };
type Member = { id: string; name: string; email: string; role: string };

/** Security levels of a project: who may see issues placed in each level. Project admins edit them. */
export function SecurityLevels({ token, projectId }: { token: string; projectId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const levelsQ = useQuery({
    queryKey: ["security-levels", projectId],
    queryFn: () => request<Levels>(token, `/projects/${projectId}/security-levels`),
    enabled: !!projectId,
  });
  const membersQ = useQuery({
    queryKey: ["members"],
    queryFn: () => request<Member[]>(token, "/members"),
    enabled: !!projectId && !!levelsQ.data?.can_manage,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["security-levels", projectId] });
  const fail = (e: unknown) => toast(errorMessage(e), { kind: "error" });
  const create = useMutation({
    mutationFn: () =>
      send(`/projects/${projectId}/security-levels`, token, "POST", { name: name.trim(), description }),
    onSuccess: () => {
      setName("");
      setDescription("");
      toast("Security level added");
      refresh();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => send<void>(`/security-levels/${id}`, token, "DELETE"),
    onSuccess: () => {
      toast("Security level removed. Its issues are open to the project again");
      refresh();
      void qc.invalidateQueries({ queryKey: ["issue-security"] });
    },
    onError: fail,
  });
  const setMembers = useMutation({
    mutationFn: ({ id, user_ids }: { id: string; user_ids: string[] }) =>
      send<void>(`/security-levels/${id}/members`, token, "PUT", { user_ids }),
    onSuccess: () => {
      toast("Level members saved");
      refresh();
    },
    onError: fail,
  });

  const data = levelsQ.data;
  if (!data) return null;
  return (
    <section
      className="mb-4 px-3.5 py-3 border border-border rounded-xl bg-surface-2 grid gap-2.5"
      aria-label="Security levels"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b>Security levels</b>
        <span className="text-text-subtle text-[11px]">
          An issue in a level is visible to project admins, its assignee, its reporter, and the level's
          members.
        </span>
      </div>
      <ul className="m-0 p-0 list-none grid gap-1.5">
        {data.levels.map((l) => (
          <li
            key={l.id}
            className="grid grid-cols-[minmax(140px,1fr)_140px_auto_auto_auto] gap-1.5 items-center max-[640px]:flex max-[640px]:flex-wrap max-[640px]:gap-2 [&_input]:min-w-0 [&_input]:max-[640px]:flex-[1_1_120px] [&_select]:min-w-0 [&_select]:max-[640px]:flex-[1_1_120px]"
            style={{ flexWrap: "wrap" }}
          >
            <span>
              {l.name}
              {l.description && <span className="text-text-subtle text-[11px]"> · {l.description}</span>}
            </span>
            {data.can_manage && (
              <>
                <fieldset className="screen-fields" style={{ width: "100%" }}>
                  <legend className="text-text-subtle text-[11px]">Members of {l.name}</legend>
                  {(membersQ.data ?? []).map((m) => (
                    <label
                      key={m.id}
                      className="inline-flex flex-row items-center gap-1.5 h-[30px] pl-2.5 pr-1 border border-dashed border-border-strong rounded-full text-xs text-text-subtle m-0 font-semibold [&_select]:border-0 [&_select]:bg-transparent [&_select]:text-inherit [&_select]:text-xs [&_select]:font-[650] [&_select]:py-1 [&_select]:pr-0 [&_select]:pl-1.5 [&_select]:max-w-[130px] [&_select]:cursor-pointer [&_select]:capitalize [&_select]:focus:outline-none [&_select]:focus:shadow-none"
                    >
                      <input
                        type="checkbox"
                        checked={l.member_ids.includes(m.id)}
                        onChange={(e) =>
                          setMembers.mutate({
                            id: l.id,
                            user_ids: e.target.checked
                              ? [...l.member_ids, m.id]
                              : l.member_ids.filter((x) => x !== m.id),
                          })
                        }
                      />{" "}
                      {m.name}
                    </label>
                  ))}
                </fieldset>
                <button
                  className="inline-grid place-items-center rounded-lg p-[5px] text-text-subtle transition-colors hover:bg-surface-3 hover:text-text-main text-danger-text"
                  aria-label={`Remove security level ${l.name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(l.id)}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </li>
        ))}
        {!data.levels.length && (
          <li className="text-text-subtle text-[11px]">
            No security levels. Every issue is open to the project.
          </li>
        )}
      </ul>
      {data.can_manage && (
        <form
          className="flex flex-wrap gap-2 items-center [&_input]:min-w-[180px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <input
            aria-label="Level name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder="Level name"
          />
          <input
            aria-label="Level description"
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
          <button
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] rounded-[var(--radius)] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 text-[13px] bg-surface border border-border-strong text-text-muted hover:bg-surface-3 hover:text-text-main"
            type="submit"
            disabled={!name.trim() || create.isPending}
          >
            <Plus size={14} /> Add level
          </button>
        </form>
      )}
    </section>
  );
}
