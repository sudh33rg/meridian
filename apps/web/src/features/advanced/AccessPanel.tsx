import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, UserPlus } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

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
    <div className="ext-wrap space-y-6">
      <PageHeader
        title={`Access to ${project.name}`}
        subtitle="Manage member permissions, team grants, and project visibility."
      />

      {/* Visibility Card */}
      <Card className="panel-card space-y-4">
        <CardHeader className="pb-2 border-b border-border">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle flex items-center gap-2">
            <Lock size={16} /> Visibility &amp; Project Level
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
            <span className="text-text-subtle font-medium">Your access:</span>
            <span className="tag px-2 py-0.5 rounded-full bg-accent/10 text-accent font-semibold text-xs border border-accent/20">
              {project.access}
            </span>
            <span className="text-text-subtle font-medium ml-2">Visibility:</span>
            <span className="tag px-2 py-0.5 rounded-full bg-surface-2 text-text-main font-semibold text-xs border border-border">
              {project.visibility === "private" ? "Private" : "Whole workspace"}
            </span>
          </div>

          {!admin && (
            <p className="muted text-xs text-text-subtle italic">
              Only project admins can change who has access.
            </p>
          )}

          {admin && (
            <label className="block space-y-1.5 text-xs sm:text-sm font-medium text-text-main">
              <span>Who can see this project</span>
              <select
                value={project.visibility}
                onChange={(e) => visibility.mutate(e.target.value)}
                className="w-full sm:max-w-md px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="workspace">Everyone in the workspace</option>
                <option value="private">Only people and teams listed below</option>
              </select>
            </label>
          )}
        </CardContent>
      </Card>

      {/* Explicit Grants Table */}
      {admin && (
        <Card className="panel-card space-y-4">
          <CardHeader className="pb-2 border-b border-border">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle flex items-center gap-2">
              <UserPlus size={16} /> Explicit Grants
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <p className="muted text-xs sm:text-sm text-text-subtle">
              Workspace owners and admins always have full access.
            </p>
            <div className="overflow-x-auto border border-border rounded-xl">
              <table className="panel-table w-full text-left text-xs sm:text-sm">
                <thead className="bg-surface-2 border-b border-border text-text-subtle font-semibold uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Who</th>
                    <th className="p-3">Level</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {(grants.data ?? []).map((g) => (
                    <tr key={g.subject_type + g.subject_id} className="hover:bg-surface-2 transition-colors">
                      <td className="p-3">
                        <span className="font-semibold text-text-main">{g.name || g.subject_id}</span>{" "}
                        <span className="tag text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-surface border border-border text-text-subtle ml-1">
                          {g.subject_type}
                        </span>
                        {g.email && <span className="muted text-text-subtle text-xs ml-1">({g.email})</span>}
                      </td>
                      <td className="p-3 capitalize text-text-main font-medium">{g.relation}</td>
                      <td className="p-3 text-right">
                        <button
                          className="secondary px-2.5 py-1 bg-surface hover:bg-danger/10 hover:text-danger border border-border rounded-lg text-xs font-medium text-text-main transition-colors"
                          onClick={() => revoke.mutate(g)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!(grants.data ?? []).length && (
                    <tr>
                      <td colSpan={3} className="p-4 text-center muted text-xs text-text-subtle">
                        {grants.isLoading ? "Loading…" : "No explicit grants yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="row-gap flex flex-col sm:flex-row gap-2 pt-2">
              <select
                aria-label="Person or team"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="flex-1 px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main"
              >
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
              <select
                aria-label="Access level"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              <button
                className="primary px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs sm:text-sm font-medium transition-colors disabled:opacity-50"
                disabled={!subject || grant.isPending}
                onClick={() => grant.mutate()}
              >
                Grant access
              </button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
