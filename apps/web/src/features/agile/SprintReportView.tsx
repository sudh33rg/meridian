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
    <div
      className="overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Sprint Report"
    >
      <div className="modal max-w-2xl w-full max-h-[90vh] flex flex-col gap-4 p-4 sm:p-6 bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="modal-head flex items-start justify-between gap-4 pb-2 border-b border-border">
          <h3 className="text-base sm:text-lg font-bold text-text">
            Sprint Report: {data?.sprint_name ?? "Loading..."}
          </h3>
          <button
            className="icon-btn p-1.5 rounded-lg text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {rep.isLoading && <p className="muted small text-xs text-muted">Loading sprint report…</p>}

        {data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="stat-card p-3 bg-surface-2 rounded-xl border border-border">
                <span className="small muted text-xs text-muted font-medium block">Committed</span>
                <strong className="text-base sm:text-lg font-bold text-text block mt-0.5">
                  {data.committed_points} pts
                </strong>
              </div>
              <div className="stat-card p-3 bg-surface-2 rounded-xl border border-border">
                <span className="small muted text-xs text-muted font-medium block">Completed</span>
                <strong className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400 block mt-0.5">
                  {data.completed_points} pts
                </strong>
              </div>
              <div className="stat-card p-3 bg-surface-2 rounded-xl border border-border">
                <span className="small muted text-xs text-muted font-medium block">Incomplete</span>
                <strong className="text-base sm:text-lg font-bold text-amber-600 dark:text-amber-400 block mt-0.5">
                  {data.incomplete_points} pts
                </strong>
              </div>
              <div className="stat-card p-3 bg-surface-2 rounded-xl border border-border">
                <span className="small muted text-xs text-muted font-medium block">Scope Creep</span>
                <strong className="text-base sm:text-lg font-bold text-rose-600 dark:text-rose-400 block mt-0.5">
                  +{data.scope_creep_points} pts
                </strong>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs sm:text-sm font-semibold text-text">Sprint Scope &amp; Tracking</h4>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
                <table className="w-full text-xs text-left">
                  <thead className="bg-surface-2 border-b border-border sticky top-0">
                    <tr className="text-muted font-medium">
                      <th className="py-2.5 px-3">Key</th>
                      <th className="py-2.5 px-3">Title</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Pts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.items.map((item) => (
                      <tr key={item.id} className="hover:bg-surface-2 transition-colors">
                        <td className="py-2 px-3 mono font-mono text-[11px] text-muted">
                          {projectKey}-{item.number}
                        </td>
                        <td className="py-2 px-3 font-medium text-text max-w-xs truncate">{item.title}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`chip small inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              item.category === "added"
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                : "bg-surface-2 text-text border border-border"
                            }`}
                          >
                            {item.category === "added" ? (
                              <>
                                <PlusCircle size={10} /> Added mid-sprint
                              </>
                            ) : (
                              "Committed"
                            )}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          {item.completed ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                              <CheckCircle size={12} /> {item.status}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-muted">
                              <AlertCircle size={12} /> {item.status}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-text">
                          {item.story_points ?? "—"}
                        </td>
                      </tr>
                    ))}
                    {data.items.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-xs text-muted">
                          No issues tracked in this sprint.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
