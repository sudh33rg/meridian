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
    <section className="workflow" aria-label="Security levels">
      <div className="workflow-head">
        <b>Security levels</b>
        <span className="muted small">
          An issue in a level is visible to project admins, its assignee, its reporter, and the level's
          members.
        </span>
      </div>
      <ul className="workflow-list">
        {data.levels.map((l) => (
          <li key={l.id} className="workflow-row" style={{ flexWrap: "wrap" }}>
            <span>
              {l.name}
              {l.description && <span className="muted small"> · {l.description}</span>}
            </span>
            {data.can_manage && (
              <>
                <fieldset className="screen-fields" style={{ width: "100%" }}>
                  <legend className="muted small">Members of {l.name}</legend>
                  {(membersQ.data ?? []).map((m) => (
                    <label key={m.id} className="filter-chip">
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
                  className="icon-btn danger"
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
          <li className="muted small">No security levels. Every issue is open to the project.</li>
        )}
      </ul>
      {data.can_manage && (
        <form
          className="workflow-add"
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
          <button className="secondary" type="submit" disabled={!name.trim() || create.isPending}>
            <Plus size={14} /> Add level
          </button>
        </form>
      )}
    </section>
  );
}
