import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";

type Scheme = { member_level: number; edit_min: number; workflow_min: number };

/** The project's permission scheme: what members may change. Project admins change it. */
export function PermissionScheme({ token, projectId }: { token: string; projectId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Scheme | null>(null);
  const schemeQ = useQuery({
    queryKey: ["permission-scheme", projectId],
    queryFn: () => request<Scheme>(token, `/projects/${projectId}/permission-scheme`),
    enabled: !!projectId,
  });
  const save = useMutation({
    mutationFn: (next: Scheme) => send<Scheme>(`/projects/${projectId}/permission-scheme`, token, "PUT", next),
    onSuccess: () => {
      setDraft(null);
      toast("Permission scheme saved");
      void qc.invalidateQueries({ queryKey: ["permission-scheme", projectId] });
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });
  const current = draft ?? schemeQ.data;
  if (!current) return null;
  return (
    <section className="workflow" aria-label="Permission scheme">
      <div className="workflow-head">
        <b>Permissions</b>
        <span className="muted small">
          Owners and admins always have full access. These settings decide what members may do.
        </span>
      </div>
      <div className="workflow-add">
        <label>
          <span className="muted small">Members see this project as</span>
          <select
            value={current.member_level}
            onChange={(e) => setDraft({ ...current, member_level: Number(e.target.value) })}
          >
            <option value={1}>Viewers (read only)</option>
            <option value={2}>Members (can change work)</option>
          </select>
        </label>
        <label>
          <span className="muted small">Changing issues needs</span>
          <select value={current.edit_min} onChange={(e) => setDraft({ ...current, edit_min: Number(e.target.value) })}>
            <option value={2}>Member</option>
            <option value={3}>Admin</option>
          </select>
        </label>
        <label>
          <span className="muted small">Changing the workflow and fields needs</span>
          <select
            value={current.workflow_min}
            onChange={(e) => setDraft({ ...current, workflow_min: Number(e.target.value) })}
          >
            <option value={2}>Member</option>
            <option value={3}>Admin</option>
          </select>
        </label>
        {draft && (
          <button className="primary" disabled={save.isPending} onClick={() => save.mutate(draft)}>
            Save permissions
          </button>
        )}
      </div>
    </section>
  );
}
