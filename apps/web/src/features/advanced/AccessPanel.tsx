import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";

type Grant = {
  subject_type: "user" | "team";
  subject_id: string;
  name?: string;
  email?: string;
  relation: string;
};
type Member = { id: string; name: string; email: string };
type Team = { id: string; name: string };

export function AccessPanel() {
  const { project, setError } = useWorkspace();
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("editor");
  const admin = project?.access === "admin";
  const pid = project?.id;
  const grants = useQuery({
    queryKey: ["access", pid],
    queryFn: () => api<Grant[]>(`/projects/${pid}/access`),
    enabled: !!pid && admin,
  });
  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => api<Member[]>("/members"),
    enabled: !!pid && admin,
  });
  const teams = useQuery({
    queryKey: ["teams"],
    queryFn: () => api<Team[]>("/teams"),
    enabled: !!pid && admin,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["access", pid] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };
  const visibility = useMutation({
    mutationFn: (v: string) => send<void>(`/projects/${pid}`, "", "PATCH", { visibility: v }),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  const grant = useMutation({
    mutationFn: () => {
      const [subject_type, subject_id] = subject.split(":");
      return send<void>(`/projects/${pid}/access`, "", "PUT", { subject_type, subject_id, level });
    },
    onSuccess: () => {
      setSubject("");
      refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (g: Grant) =>
      send<void>(`/projects/${pid}/access/${g.subject_type}/${g.subject_id}`, "", "DELETE"),
    onSuccess: refresh,
    onError: (e) => setError(errorMessage(e)),
  });
  if (!project) return null;
  return (
    <div className="ext-wrap">
      <div className="panel-card">
        <h3>
          <Lock size={18} /> Access to {project.name}
        </h3>
        <p className="muted">
          Your access: <span className="tag">{project.access}</span> · Visibility:{" "}
          <span className="tag">{project.visibility === "private" ? "Private" : "Whole workspace"}</span>
        </p>
        {!admin && <p className="muted">Only project admins can change who has access.</p>}
        {admin && (
          <label>
            Who can see this project
            <select value={project.visibility} onChange={(e) => visibility.mutate(e.target.value)}>
              <option value="workspace">Everyone in the workspace</option>
              <option value="private">Only people and teams listed below</option>
            </select>
          </label>
        )}
      </div>
      {admin && (
        <div className="panel-card">
          <h3>Grants</h3>
          <p className="muted">Workspace owners and admins always have full access.</p>
          <table className="panel-table">
            <thead>
              <tr>
                <th>Who</th>
                <th>Level</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(grants.data ?? []).map((g) => (
                <tr key={g.subject_type + g.subject_id}>
                  <td>
                    {g.name || g.subject_id} <span className="tag">{g.subject_type}</span>
                    {g.email && <span className="muted"> {g.email}</span>}
                  </td>
                  <td>{g.relation}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="secondary" onClick={() => revoke.mutate(g)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!(grants.data ?? []).length && (
                <tr>
                  <td colSpan={3} className="muted">
                    {grants.isLoading ? "Loading…" : "No explicit grants yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="row-gap" style={{ marginTop: 14 }}>
            <select aria-label="Person or team" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Choose a person or team…</option>
              <optgroup label="People">
                {(members.data ?? []).map((m) => (
                  <option key={m.id} value={`user:${m.id}`}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Teams">
                {(teams.data ?? []).map((t) => (
                  <option key={t.id} value={`team:${t.id}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <select aria-label="Access level" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
            <button className="primary" disabled={!subject || grant.isPending} onClick={() => grant.mutate()}>
              Grant access
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
