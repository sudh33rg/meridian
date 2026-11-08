import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, send, errorMessage } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { useToast } from "../shared/Toast";
import { formatDateTime } from "../../lib/datetime";
import { Flame, Plus, CheckCircle } from "lucide-react";

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
    <section className="panel" aria-label="ITIL Incidents" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h4 style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
            <Flame size={18} color="#ef4444" /> ITIL Incident Management
          </h4>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Track major outages, service degradation, root cause analysis and resolution SLAs.
          </p>
        </div>
        <button className="primary small-btn" onClick={() => setCreating((v) => !v)}>
          <Plus size={14} /> {creating ? "Cancel" : "Declare Incident"}
        </button>
      </div>

      {creating && (
        <form onSubmit={createIncident} style={{ background: "var(--bg-subtle)", padding: 12, borderRadius: 6, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
            <label className="small">
              Issue ID / UUID
              <input
                type="text"
                placeholder="Enter issue ID for this incident"
                value={issueId}
                onChange={(e) => setIssueId(e.target.value)}
                required
              />
            </label>
            <label className="small">
              Severity
              <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="p1">P1 - Critical Outage</option>
                <option value="p2">P2 - Major Impairment</option>
                <option value="p3">P3 - Minor Incident</option>
                <option value="p4">P4 - Low Impact</option>
              </select>
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <label className="small">
              Customer Impact
              <input
                type="text"
                placeholder="e.g. 15% checkout transactions failing"
                value={impact}
                onChange={(e) => setImpact(e.target.value)}
              />
            </label>
            <label className="small">
              Root Cause Hypothesis
              <input
                type="text"
                placeholder="e.g. Upstream DNS resolution failure"
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
              />
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="secondary small-btn" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" className="primary small-btn" disabled={!issueId.trim()}>
              Confirm & Alert
            </button>
          </div>
        </form>
      )}

      {incidents.isLoading && <p className="small muted">Loading incidents…</p>}

      {list.length === 0 && !incidents.isLoading && (
        <p className="small muted">No incidents reported. All systems operating normally.</p>
      )}

      {list.length > 0 && (
        <table className="simple-table" style={{ width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Incident & Issue</th>
              <th>Status</th>
              <th>Impact</th>
              <th>Started</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((inc) => (
              <tr key={inc.id}>
                <td>
                  <span
                    className="chip small"
                    style={{
                      background: `${SEVERITY_COLORS[inc.severity] ?? "#6b7280"}20`,
                      color: SEVERITY_COLORS[inc.severity] ?? "#6b7280",
                      fontWeight: 700,
                    }}
                  >
                    {inc.severity.toUpperCase()}
                  </span>
                </td>
                <td>
                  <button
                    className="issue-number-button"
                    style={{ fontWeight: 600, marginRight: 6 }}
                    onClick={() => setSelectedIssue(inc.issue_id)}
                  >
                    #{inc.issue_number}
                  </button>
                  <span>{inc.title}</span>
                  {inc.root_cause && <div className="small muted">RCA: {inc.root_cause}</div>}
                </td>
                <td>
                  <select
                    value={inc.status}
                    onChange={(e) => updateIncident(inc.id, { status: e.target.value })}
                    style={{ fontSize: 12, padding: "2px 6px" }}
                  >
                    <option value="investigating">Investigating</option>
                    <option value="identified">Identified</option>
                    <option value="monitoring">Monitoring</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </td>
                <td className="small">{inc.impact || "—"}</td>
                <td className="small muted">{formatDateTime(inc.started_at)}</td>
                <td>
                  {inc.status !== "resolved" && (
                    <button
                      className="secondary small-btn"
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
      )}
    </section>
  );
}
