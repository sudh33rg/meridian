import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, send, errorMessage } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { useToast } from "../shared/Toast";
import { ShieldAlert, Plus, Trash2 } from "lucide-react";

export type RaidItem = {
  id: string;
  project_id: string;
  kind: string; // "risk" | "assumption" | "issue" | "dependency"
  title: string;
  description: string;
  severity: string;
  status: string;
  owner_id: string | null;
  due_date: string | null;
  created_at: string;
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "#10b981",
  medium: "#3b82f6",
  high: "#f59e0b",
  critical: "#ef4444",
};

export function RaidRegisterView({ projectId }: { projectId: string }) {
  const { session, setError } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [kindFilter, setKindFilter] = useState("all");
  const [newKind, setNewKind] = useState("risk");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newSeverity, setNewSeverity] = useState("medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [creating, setCreating] = useState(false);

  const raid = useQuery({
    queryKey: ["raid-items", projectId],
    queryFn: () => request<RaidItem[]>(session.token, `/projects/${projectId}/raid`),
  });

  const addItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await send(`/projects/${projectId}/raid`, session.token, "POST", {
        kind: newKind,
        title: newTitle.trim(),
        description: newDesc.trim() || null,
        severity: newSeverity,
        status: "open",
        due_date: newDueDate || null,
      });
      setNewTitle("");
      setNewDesc("");
      setNewDueDate("");
      setCreating(false);
      toast("RAID item recorded");
      await qc.invalidateQueries({ queryKey: ["raid-items", projectId] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await send(`/raid/${id}`, session.token, "PATCH", { status });
      toast(`Status updated to ${status}`);
      await qc.invalidateQueries({ queryKey: ["raid-items", projectId] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const deleteItem = async (id: string) => {
    try {
      await send(`/raid/${id}`, session.token, "DELETE");
      toast("RAID item deleted");
      await qc.invalidateQueries({ queryKey: ["raid-items", projectId] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const items = (raid.data ?? []).filter((i) => (kindFilter === "all" ? true : i.kind === kindFilter));

  return (
    <div className="raid-register" style={{ marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h3 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
            <ShieldAlert size={20} /> RAID Register
          </h3>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            Comprehensive governance of Risks, Assumptions, Issues, and Dependencies.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            style={{ padding: "4px 8px" }}
          >
            <option value="all">All Types</option>
            <option value="risk">Risks</option>
            <option value="assumption">Assumptions</option>
            <option value="issue">Issues</option>
            <option value="dependency">Dependencies</option>
          </select>
          <button className="primary small-btn" onClick={() => setCreating((v) => !v)}>
            <Plus size={14} /> {creating ? "Cancel" : "Add RAID Item"}
          </button>
        </div>
      </div>

      {creating && (
        <form
          onSubmit={addItem}
          style={{ background: "var(--bg-subtle)", padding: 16, borderRadius: 8, marginBottom: 16 }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <label className="small">
              Type
              <select value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                <option value="risk">Risk</option>
                <option value="assumption">Assumption</option>
                <option value="issue">Issue</option>
                <option value="dependency">Dependency</option>
              </select>
            </label>
            <label className="small">
              Severity
              <select value={newSeverity} onChange={(e) => setNewSeverity(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="small">
              Due Date
              <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} />
            </label>
          </div>
          <label className="small" style={{ display: "block", marginBottom: 12 }}>
            Title
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Third-party payment gateway API rate limits during launch"
              required
              style={{ width: "100%" }}
            />
          </label>
          <label className="small" style={{ display: "block", marginBottom: 12 }}>
            Mitigation / Description
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Detailed description and mitigation strategy..."
              rows={2}
              style={{ width: "100%" }}
            />
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="secondary small-btn" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" className="primary small-btn" disabled={!newTitle.trim()}>
              Save RAID Item
            </button>
          </div>
        </form>
      )}

      {raid.isLoading && <p className="muted small">Loading RAID items…</p>}

      {raid.data && (
        <div style={{ overflowX: "auto" }}>
          <table className="simple-table" style={{ width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Title & Description</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Due</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <span className="chip small" style={{ textTransform: "capitalize", fontWeight: 600 }}>
                      {i.kind}
                    </span>
                  </td>
                  <td>
                    <strong>{i.title}</strong>
                    {i.description && (
                      <div className="small muted" style={{ marginTop: 2 }}>
                        {i.description}
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className="chip small"
                      style={{
                        background: `${SEVERITY_COLORS[i.severity] ?? "#6b7280"}20`,
                        color: SEVERITY_COLORS[i.severity] ?? "#6b7280",
                        fontWeight: 600,
                      }}
                    >
                      {i.severity}
                    </span>
                  </td>
                  <td>
                    <select
                      value={i.status}
                      onChange={(e) => updateStatus(i.id, e.target.value)}
                      style={{ fontSize: 12, padding: "2px 6px" }}
                    >
                      <option value="open">Open</option>
                      <option value="mitigated">Mitigated</option>
                      <option value="closed">Closed</option>
                    </select>
                  </td>
                  <td className="small muted">{i.due_date || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="icon-ghost"
                      onClick={() => deleteItem(i.id)}
                      title="Delete item"
                      aria-label="Delete RAID item"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 24 }} className="muted">
                    No RAID items recorded for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
