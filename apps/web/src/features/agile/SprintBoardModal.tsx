import React from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { X, Kanban } from "lucide-react";

export type BoardIssue = {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  story_points: number | null;
  assignee_id: string | null;
  assignee_name?: string | null;
};

export type BoardLane = {
  key: string;
  label: string;
  issues: BoardIssue[];
};

export type BoardView = {
  group_by: string;
  truncated: boolean;
  lanes: BoardLane[];
};

export function SprintBoardModal({
  sprintId,
  sprintName,
  projectKey,
  onClose,
}: {
  sprintId: string;
  sprintName: string;
  projectKey: string;
  onClose: () => void;
}) {
  const { session } = useWorkspace();
  const board = useQuery({
    queryKey: ["sprint-board", sprintId],
    queryFn: () => request<BoardView>(session.token, `/sprints/${sprintId}/board`),
  });

  const data = board.data;

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Sprint Board"
    >
      <div
        className="modal"
        style={{ maxWidth: 960, width: "90vw", maxHeight: "85vh", display: "flex", flexDirection: "column" }}
      >
        <div className="modal-head">
          <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Kanban size={18} /> Sprint Board: {sprintName}
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {board.isLoading && <p className="muted small">Loading sprint board…</p>}

        {data && (
          <div
            style={{
              display: "grid",
              gridAutoColumns: "minmax(200px, 1fr)",
              gridAutoFlow: "column",
              gap: 12,
              overflowX: "auto",
              flex: 1,
              paddingBottom: 8,
            }}
          >
            {data.lanes.map((lane) => {
              const laneIssues = lane.issues || [];
              return (
                <div
                  key={lane.key}
                  style={{
                    background: "var(--bg-subtle)",
                    borderRadius: 8,
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 220,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    <span>{lane.label}</span>
                    <span className="chip small">{laneIssues.length}</span>
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflowY: "auto" }}
                  >
                    {laneIssues.map((issue) => (
                      <div
                        key={issue.id}
                        style={{
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: 8,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 11,
                            marginBottom: 4,
                          }}
                          className="muted"
                        >
                          <span className="mono">
                            {projectKey}-{issue.number}
                          </span>
                          <span className={`chip small priority-${issue.priority}`}>{issue.priority}</span>
                        </div>
                        <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 500 }}>{issue.title}</p>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: 11,
                          }}
                          className="muted"
                        >
                          <span>{issue.assignee_name || "Unassigned"}</span>
                          {issue.story_points != null && <span>{issue.story_points} pt</span>}
                        </div>
                      </div>
                    ))}
                    {laneIssues.length === 0 && (
                      <div className="muted small" style={{ textAlign: "center", padding: "16px 8px" }}>
                        Empty
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
