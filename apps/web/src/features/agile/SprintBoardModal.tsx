import React from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { X, Kanban } from "lucide-react";
import { PriorityBadge } from "../shared/UiComponents";

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-xs place-items-center animate-[fade_var(--dur)_var(--ease)]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Sprint Board"
    >
      <div className="max-w-5xl w-full max-h-[85vh] flex flex-col gap-4 p-4 sm:p-6 bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden animate-[pop_var(--dur)_var(--ease)] [&_h2]:text-[22px] [&_h2]:mt-2 [&_h2]:mb-0">
        <div className="flex items-start justify-between gap-4 pb-2 border-b border-border mb-5">
          <h3 className="flex items-center gap-2 text-base sm:text-lg font-bold text-text">
            <Kanban size={18} className="text-accent" /> Sprint Board: {sprintName}
          </h3>
          <button
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer inline-grid place-items-center"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {board.isLoading && <p className="text-xs text-muted">Loading sprint board…</p>}

        {data && (
          <div className="grid grid-flow-col auto-cols-[minmax(240px,1fr)] gap-3 overflow-x-auto flex-1 pb-2">
            {data.lanes.map((lane) => {
              const laneIssues = lane.issues || [];
              return (
                <div
                  key={lane.key}
                  className="bg-surface-2 rounded-xl p-3 flex flex-col min-w-[240px] max-h-[65vh] border border-border"
                >
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-semibold text-text uppercase tracking-wider">
                      {lane.label}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-surface text-text border border-border capitalize whitespace-nowrap">
                      {laneIssues.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 flex-1 overflow-y-auto pr-1">
                    {laneIssues.map((issue) => (
                      <div
                        key={issue.id}
                        className="bg-surface border border-border rounded-lg p-3 shadow-xs space-y-2 hover:border-indigo-500/40 transition-colors"
                      >
                        <div className="flex justify-between items-center text-xs">
                          <span className="mono font-mono text-[11px] text-muted font-medium">
                            {projectKey}-{issue.number}
                          </span>
                          <PriorityBadge priority={issue.priority} />
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-text line-clamp-2 leading-snack">
                          {issue.title}
                        </p>
                        <div className="flex justify-between items-center text-[11px] text-muted pt-1 border-t border-border">
                          <span className="truncate max-w-[120px]">
                            {issue.assignee_name || "Unassigned"}
                          </span>
                          {issue.story_points != null && (
                            <span className="font-semibold text-text">{issue.story_points} pt</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {laneIssues.length === 0 && (
                      <div className="text-xs text-muted text-center py-8">Empty</div>
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
