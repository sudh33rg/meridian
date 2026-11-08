import React from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { X, CheckCircle, AlertCircle, PlusCircle } from "lucide-react";

export type SprintReportItem = {
  id: string;
  number: number;
  title: string;
  status: string;
  story_points: number | null;
  category: string; // "committed" | "added" | "removed"
  completed: boolean;
};

export type SprintReport = {
  sprint_id: string;
  sprint_name: string;
  state: string;
  committed_points: number;
  completed_points: number;
  incomplete_points: number;
  scope_creep_points: number;
  items: SprintReportItem[];
};

export function SprintReportView({
  sprintId,
  projectKey,
  onClose,
}: {
  sprintId: string;
  projectKey: string;
  onClose: () => void;
}) {
  const { session } = useWorkspace();
  const rep = useQuery({
    queryKey: ["sprint-report", sprintId],
    queryFn: () => request<SprintReport>(session.token, `/sprints/${sprintId}/report`),
  });

  const data = rep.data;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Sprint Report">
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-head">
          <h3>Sprint Report: {data?.sprint_name ?? "Loading..."}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {rep.isLoading && <p className="muted small">Loading sprint report…</p>}

        {data && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
              <div className="stat-card" style={{ padding: 12, background: "var(--bg-subtle)", borderRadius: 6 }}>
                <span className="small muted">Committed</span>
                <strong style={{ display: "block", fontSize: 18 }}>{data.committed_points} pts</strong>
              </div>
              <div className="stat-card" style={{ padding: 12, background: "var(--bg-subtle)", borderRadius: 6 }}>
                <span className="small muted">Completed</span>
                <strong style={{ display: "block", fontSize: 18, color: "#10b981" }}>{data.completed_points} pts</strong>
              </div>
              <div className="stat-card" style={{ padding: 12, background: "var(--bg-subtle)", borderRadius: 6 }}>
                <span className="small muted">Incomplete</span>
                <strong style={{ display: "block", fontSize: 18, color: "#f59e0b" }}>{data.incomplete_points} pts</strong>
              </div>
              <div className="stat-card" style={{ padding: 12, background: "var(--bg-subtle)", borderRadius: 6 }}>
                <span className="small muted">Scope Creep</span>
                <strong style={{ display: "block", fontSize: 18, color: "#ef4444" }}>+{data.scope_creep_points} pts</strong>
              </div>
            </div>

            <h4 style={{ margin: "16px 0 8px" }}>Sprint Scope & Tracking</h4>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Key</th>
                    <th style={{ padding: "6px 8px" }}>Title</th>
                    <th style={{ padding: "6px 8px" }}>Type</th>
                    <th style={{ padding: "6px 8px" }}>Status</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "6px 8px" }} className="mono small">
                        {projectKey}-{item.number}
                      </td>
                      <td style={{ padding: "6px 8px" }}>{item.title}</td>
                      <td style={{ padding: "6px 8px" }}>
                        <span className={`chip small ${item.category === "added" ? "warning" : ""}`}>
                          {item.category === "added" ? (
                            <><PlusCircle size={10} style={{ marginRight: 2 }} /> Added mid-sprint</>
                          ) : (
                            "Committed"
                          )}
                        </span>
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        {item.completed ? (
                          <span style={{ color: "#10b981", display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <CheckCircle size={12} /> {item.status}
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <AlertCircle size={12} /> {item.status}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{item.story_points ?? "—"}</td>
                    </tr>
                  ))}
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 12, textAlign: "center" }} className="muted">
                        No issues tracked in this sprint.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
