import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, send, errorMessage } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { useToast } from "../shared/Toast";
import { formatDateTime } from "../../lib/datetime";
import { Flame, Plus, CheckCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

export type ServiceIncident = {
  id: string;
  project_id: string;
  issue_id: string;
  issue_number: number;
  title: string;
  severity: string;
  impact: string;
  root_cause: string;
  status: string;
  started_at: string;
  resolved_at: string | null;
  created_at: string;
};

const SEVERITY_COLORS: Record<string, string> = {
  p1: "#ef4444",
  p2: "#f97316",
  p3: "#f59e0b",
  p4: "#3b82f6",
};

export function IncidentsView({ projectId }: { projectId: string }) {
  const { session, setError, setSelectedIssue } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [issueId, setIssueId] = useState("");
  const [severity, setSeverity] = useState("p2");
  const [impact, setImpact] = useState("");
  const [rootCause, setRootCause] = useState("");

  const incidents = useQuery({
    queryKey: ["service-incidents", projectId],
    queryFn: () => request<ServiceIncident[]>(session.token, `/projects/${projectId}/incidents`),
  });

  const createIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueId.trim()) return;
    try {
      await send(`/projects/${projectId}/incidents`, session.token, "POST", {
        issue_id: issueId.trim(),
        severity,
        impact: impact.trim() || null,
        root_cause: rootCause.trim() || null,
      });
      setIssueId("");
      setImpact("");
      setRootCause("");
      setCreating(false);
      toast("Incident created");
      await qc.invalidateQueries({ queryKey: ["service-incidents", projectId] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const updateIncident = async (id: string, patch: Partial<ServiceIncident>) => {
    try {
      await send(`/incidents/${id}`, session.token, "PATCH", patch);
      toast("Incident updated");
      await qc.invalidateQueries({ queryKey: ["service-incidents", projectId] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const list = incidents.data ?? [];

  return (
    <Card
      className="mt-4 space-y-4 p-4 sm:p-6 bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)]"
      aria-label="ITIL Incidents"
    >
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-bold text-text-main">
            <Flame size={18} className="text-red-500" /> ITIL Incident Management
          </CardTitle>
          <p className="text-xs sm:text-sm text-text-subtle mt-1">
            Track major outages, service degradation, root cause analysis and resolution SLAs.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs font-medium transition-colors shadow-sm justify-center whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px]"
          onClick={() => setCreating((v) => !v)}
        >
          <Plus size={14} /> {creating ? "Cancel" : "Declare Incident"}
        </button>
      </CardHeader>

      <CardContent className="space-y-4 p-0">
        {creating && (
          <form
            onSubmit={createIncident}
            className="p-4 bg-surface-2 rounded-xl border border-border space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block space-y-1 text-xs sm:col-span-2">
                <span className="font-semibold text-text-subtle">Issue ID / UUID</span>
                <input
                  type="text"
                  placeholder="Enter issue ID for this incident"
                  value={issueId}
                  onChange={(e) => setIssueId(e.target.value)}
                  required
                  className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-text-main"
                />
              </label>
              <label className="block space-y-1 text-xs">
                <span className="font-semibold text-text-subtle">Severity</span>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-surface border border-border rounded-xl text-xs text-text-main"
                >
                  <option value="p1">P1 - Critical Outage</option>
                  <option value="p2">P2 - Major Impairment</option>
                  <option value="p3">P3 - Minor Incident</option>
                  <option value="p4">P4 - Low Impact</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1 text-xs">
                <span className="font-semibold text-text-subtle">Customer Impact</span>
                <input
                  type="text"
                  placeholder="e.g. 15% checkout transactions failing"
                  value={impact}
                  onChange={(e) => setImpact(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-text-main"
                />
              </label>
              <label className="block space-y-1 text-xs">
                <span className="font-semibold text-text-subtle">Root Cause Hypothesis</span>
                <input
                  type="text"
                  placeholder="e.g. Upstream DNS resolution failure"
                  value={rootCause}
                  onChange={(e) => setRootCause(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs text-text-main"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="px-3 py-1.5 bg-surface hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] hover:text-text-main"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-danger hover:bg-danger/90 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px] shadow-[var(--shadow-sm)]"
                disabled={!issueId.trim()}
              >
                Confirm &amp; Alert
              </button>
            </div>
          </form>
        )}

        {incidents.isLoading && (
          <p className="text-xs text-text-subtle p-6 text-center">Loading incidents…</p>
        )}

        {list.length === 0 && !incidents.isLoading && (
          <p className="text-xs text-text-subtle p-8 text-center">
            No incidents reported. All systems operating normally.
          </p>
        )}

        {list.length > 0 && (
          <div className="overflow-x-auto border border-border rounded-xl">
            <table className="w-full text-left text-xs sm:text-sm border-collapse [&_th]:text-left [&_th]:px-1 [&_th]:py-1.5 [&_th]:border-b [&_th]:border-divider [&_td]:text-left [&_td]:px-1 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-divider">
              <thead className="bg-surface-2 border-b border-border text-text-subtle font-semibold uppercase text-[10px]">
                <tr>
                  <th className="p-3">Severity</th>
                  <th className="p-3">Incident &amp; Issue</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Impact</th>
                  <th className="p-3">Started</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {list.map((inc) => (
                  <tr key={inc.id} className="hover:bg-surface-2 transition-colors">
                    <td className="p-3">
                      <span
                        className="uppercase text-[10px] font-bold px-2 py-0.5 rounded-full capitalize whitespace-nowrap bg-accent-soft text-accent-text"
                        style={{
                          background: `${SEVERITY_COLORS[inc.severity] ?? "#6b7280"}20`,
                          color: SEVERITY_COLORS[inc.severity] ?? "#6b7280",
                        }}
                      >
                        {inc.severity.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-3">
                      <button
                        className="font-mono font-bold text-accent hover:underline mr-2 block p-0 text-left text-[11px] tabular-nums hover:text-accent-text"
                        onClick={() => setSelectedIssue(inc.issue_id)}
                      >
                        #{inc.issue_number}
                      </button>
                      <span className="font-medium text-text-main">{inc.title}</span>
                      {inc.root_cause && (
                        <div className="text-xs text-text-subtle mt-0.5">RCA: {inc.root_cause}</div>
                      )}
                    </td>
                    <td className="p-3">
                      <select
                        value={inc.status}
                        onChange={(e) => updateIncident(inc.id, { status: e.target.value })}
                        className="px-2 py-1 bg-surface border border-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        <option value="investigating">Investigating</option>
                        <option value="identified">Identified</option>
                        <option value="monitoring">Monitoring</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </td>
                    <td className="p-3 text-text-subtle text-[11px]">{inc.impact || "—"}</td>
                    <td className="p-3 font-mono text-[11px] text-text-subtle">
                      {formatDateTime(inc.started_at)}
                    </td>
                    <td className="p-3 text-right">
                      {inc.status !== "resolved" && (
                        <button
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-surface-2 hover:bg-emerald-500/10 hover:text-emerald-600 border border-border rounded-lg text-xs font-medium transition-colors justify-center whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] text-text-muted"
                          onClick={() => updateIncident(inc.id, { status: "resolved" })}
                        >
                          <CheckCircle size={12} /> Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
