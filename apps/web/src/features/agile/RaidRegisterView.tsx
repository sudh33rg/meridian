import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, send, errorMessage } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { useToast } from "../shared/Toast";
import { ShieldAlert, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

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
    <Card className="raid-register mt-4 space-y-4 p-4 sm:p-6">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-bold text-text-main">
            <ShieldAlert size={18} /> RAID Register
          </CardTitle>
          <p className="muted small text-xs sm:text-sm text-text-subtle mt-1">
            Track Risks, Assumptions, Issues, and Dependencies.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-bg border border-border rounded-xl text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="all">All Types</option>
            <option value="risk">Risks</option>
            <option value="assumption">Assumptions</option>
            <option value="issue">Issues</option>
            <option value="dependency">Dependencies</option>
          </select>
          <button
            className="primary small-btn inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs font-medium transition-colors shadow-sm"
            onClick={() => setCreating((v) => !v)}
          >
            <Plus size={14} /> {creating ? "Cancel" : "Add RAID Item"}
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-0">
        {creating && (
          <form onSubmit={addItem} className="p-4 bg-surface-2 rounded-xl border border-border space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="small block space-y-1 text-xs">
                <span className="font-semibold text-text-subtle">Type</span>
                <select
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-main"
                >
                  <option value="risk">Risk</option>
                  <option value="assumption">Assumption</option>
                  <option value="issue">Issue</option>
                  <option value="dependency">Dependency</option>
                </select>
              </label>
              <label className="small block space-y-1 text-xs">
                <span className="font-semibold text-text-subtle">Severity</span>
                <select
                  value={newSeverity}
                  onChange={(e) => setNewSeverity(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-main"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <label className="small block space-y-1 text-xs">
                <span className="font-semibold text-text-subtle">Due Date</span>
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-main"
                />
              </label>
            </div>
            <label className="small block space-y-1 text-xs">
              <span className="font-semibold text-text-subtle">Title</span>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Third-party payment gateway API rate limits during launch"
                required
                className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label className="small block space-y-1 text-xs">
              <span className="font-semibold text-text-subtle">Mitigation / Description</span>
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Detailed description and mitigation strategy..."
                rows={2}
                className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="secondary small-btn px-3 py-1.5 bg-surface hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary small-btn px-4 py-1.5 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
                disabled={!newTitle.trim()}
              >
                Save RAID Item
              </button>
            </div>
          </form>
        )}

        {raid.isLoading && (
          <p className="muted small text-xs text-text-subtle p-6 text-center">Loading RAID items…</p>
        )}

        {raid.data && (
          <div className="overflow-x-auto border border-border rounded-xl">
            <table className="simple-table w-full text-left text-xs sm:text-sm">
              <thead className="bg-surface-2 border-b border-border text-text-subtle font-semibold uppercase text-[10px]">
                <tr>
                  <th className="p-3">Type</th>
                  <th className="p-3">Title &amp; Description</th>
                  <th className="p-3">Severity</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Due</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {items.map((i) => (
                  <tr key={i.id} className="hover:bg-surface-2 transition-colors">
                    <td className="p-3">
                      <span className="chip small uppercase text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-3 text-text-muted border border-border">
                        {i.kind}
                      </span>
                    </td>
                    <td className="p-3">
                      <strong className="text-text-main">{i.title}</strong>
                      {i.description && (
                        <div className="small muted text-xs text-text-subtle mt-0.5 leading-relaxed">
                          {i.description}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className="chip small text-[10px] uppercase font-bold px-2 py-0.5 rounded-full"
                        style={{
                          background: `${SEVERITY_COLORS[i.severity] ?? "#6b7280"}20`,
                          color: SEVERITY_COLORS[i.severity] ?? "#6b7280",
                        }}
                      >
                        {i.severity}
                      </span>
                    </td>
                    <td className="p-3">
                      <select
                        value={i.status}
                        onChange={(e) => updateStatus(i.id, e.target.value)}
                        className="px-2 py-1 bg-surface border border-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        <option value="open">Open</option>
                        <option value="mitigated">Mitigated</option>
                        <option value="closed">Closed</option>
                      </select>
                    </td>
                    <td className="p-3 small muted font-mono text-xs text-text-subtle">
                      {i.due_date || "—"}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        className="icon-ghost p-1.5 text-text-subtle hover:text-danger rounded-lg transition-colors"
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
                    <td colSpan={6} className="p-8 text-center muted text-xs text-text-subtle">
                      No RAID items recorded for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
