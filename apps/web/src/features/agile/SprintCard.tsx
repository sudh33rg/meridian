import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Play,
  Square,
  X,
  TrendingUp,
  FileText,
  Users,
  Kanban,
  Download,
} from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { downloadCsv } from "../../lib/download";
import { useToast } from "../shared/Toast";
import { Burndown } from "./Burndown";
import { Burnup, type BurnupData } from "./Burnup";
import { SprintReportView } from "./SprintReportView";
import { SprintCapacityModal } from "./SprintCapacityModal";
import { SprintBoardModal } from "./SprintBoardModal";
import {
  type Burndown as BurndownData,
  type Sprint,
  type SprintDetail,
  type Team,
  SPRINT_STATE_LABEL,
  invalidatePlanning,
  isOpenSprint,
  shortDay,
  teamName,
} from "./agile-shared";
import { Card, CardContent } from "../shared/UiComponents";

/** One sprint: totals, its issues, start and close, and the burndown. Also a drop target for backlog items. */
export function SprintCard({
  projectId,
  projectKey,
  sprint,
  sprints,
  teams,
  compact = false,
}: {
  projectId: string;
  projectKey: string;
  sprint: Sprint;
  sprints: Sprint[];
  teams: Team[];
  compact?: boolean;
}) {
  const { session, setError } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [dropping, setDropping] = useState(false);
  const [closing, setClosing] = useState(false);
  const [carryOver, setCarryOver] = useState("backlog");
  const [showBurndown, setShowBurndown] = useState(false);
  const [showBurnup, setShowBurnup] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showCapacity, setShowCapacity] = useState(false);
  const [showBoard, setShowBoard] = useState(false);

  const detail = useQuery({
    queryKey: ["sprint", sprint.id],
    queryFn: () => request<SprintDetail>(session.token, `/sprints/${sprint.id}`),
    enabled: open || dropping,
  });

  const burn = useQuery({
    queryKey: ["burndown", sprint.id],
    queryFn: () => request<BurndownData>(session.token, `/sprints/${sprint.id}/burndown`),
    enabled: showBurndown && sprint.state !== "planned",
  });

  const burnup = useQuery({
    queryKey: ["burnup", sprint.id],
    queryFn: () => request<BurnupData>(session.token, `/sprints/${sprint.id}/burnup`),
    enabled: showBurnup && sprint.state !== "planned",
  });

  const done = async (message: string) => {
    toast(message);
    await invalidatePlanning(qc, projectId);
  };

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const issues = detail.data?.issues ?? [];
  const totals = detail.data?.totals;
  const carryTargets = sprints.filter(
    (s) => s.id !== sprint.id && isOpenSprint(s) && (!sprint.team_id || s.team_id === sprint.team_id),
  );
  const teamLabel = sprint.team_id ? teamName(teams, sprint.team_id) : null;

  const stateColors: Record<string, string> = {
    active:
      "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    planned: "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800",
    completed:
      "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700",
  };

  return (
    <Card
      className={`transition-all ${dropping ? "border-indigo-500 ring-2 ring-indigo-500/20" : ""}`}
      onDragOver={(e: React.DragEvent) => {
        if (sprint.state === "completed") return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e: React.DragEvent) => {
        if (sprint.state === "completed") return;
        e.preventDefault();
        const issueId = e.dataTransfer.getData("text/plain");
        setDropping(false);
        if (!issueId) return;
        run(async () => {
          const res = await send<MembershipResultLike>(
            `/sprints/${sprint.id}/issues`,
            session.token,
            "POST",
            { issue_ids: [issueId] },
          );
          const refused = res.results.find((r) => !r.ok);
          if (refused?.error) setError(refused.error);
          else toast(`Added to ${sprint.name}`);
          await invalidatePlanning(qc, projectId);
        });
      }}
    >
      {/* Header */}
      <div className="p-4 sm:p-5 flex items-start sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <button
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${sprint.name}`}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate m-0">
              {sprint.name}
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                  stateColors[sprint.state] || stateColors.planned
                }`}
              >
                {SPRINT_STATE_LABEL[sprint.state] ?? sprint.state}
              </span>
              {teamLabel && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {teamLabel}
                </span>
              )}
              {(sprint.starts_at || sprint.ends_at) && (
                <span className="text-slate-400">
                  {shortDay(sprint.starts_at)}
                  {sprint.ends_at ? ` – ${shortDay(sprint.ends_at)}` : ""}
                </span>
              )}
            </div>
          </div>
        </div>

        {totals && (
          <div className="text-right shrink-0">
            <div className="text-xs font-bold text-slate-900 dark:text-white">
              {totals.done_points}/{totals.scope_points} pts
            </div>
            <div className="text-[11px] text-slate-400">
              {totals.done_count}/{totals.scope_count} issues done
            </div>
          </div>
        )}
      </div>

      {open && (
        <CardContent className="p-4 sm:p-5 space-y-4">
          {sprint.goal && (
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 italic bg-slate-50 dark:bg-slate-850 p-3 rounded-lg border border-slate-100 dark:border-slate-800 m-0">
              {sprint.goal}
            </p>
          )}

          {sprint.state === "completed" && sprint.final_done_points != null && (
            <p className="text-xs text-slate-500 m-0">
              Closed with {sprint.final_done_points} of {sprint.final_scope_points ?? 0} pts done
              {sprint.carried_over_count ? `, ${sprint.carried_over_count} issues carried over` : ""}.
            </p>
          )}

          {/* Action pills toolbar */}
          {!compact && sprint.state !== "planned" && (
            <div className="flex flex-wrap gap-2 pt-1 pb-2 border-b border-slate-100 dark:border-slate-800">
              <button
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  showBurndown
                    ? "bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50"
                }`}
                onClick={() => setShowBurndown((v) => !v)}
                aria-expanded={showBurndown}
              >
                <BarChart3 size={13} /> {showBurndown ? "Hide burndown" : "Burndown"}
              </button>

              <button
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  showBurnup
                    ? "bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50"
                }`}
                onClick={() => setShowBurnup((v) => !v)}
                aria-expanded={showBurnup}
              >
                <TrendingUp size={13} /> {showBurnup ? "Hide burnup" : "Burnup"}
              </button>

              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => setShowReport(true)}
              >
                <FileText size={13} /> Sprint Report
              </button>

              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => setShowCapacity(true)}
              >
                <Users size={13} /> Capacity
              </button>

              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => setShowBoard(true)}
              >
                <Kanban size={13} /> Sprint Board
              </button>
            </div>
          )}

          {/* Burndown / Burnup Charts */}
          {showBurndown && burn.data && <Burndown data={burn.data} />}
          {showBurndown && burn.isLoading && <p className="text-xs text-slate-400">Loading burndown…</p>}
          {showBurnup && burnup.data && <Burnup data={burnup.data} />}
          {showBurnup && burnup.isLoading && <p className="text-xs text-slate-400">Loading burnup…</p>}

          {/* Issues List in this sprint */}
          <ul
            className="divide-y divide-slate-100 dark:divide-slate-800/80 m-0 p-0 list-none"
            aria-label={`Issues in ${sprint.name}`}
          >
            {issues.map((issue) => (
              <li
                key={issue.id}
                className="py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm hover:bg-slate-50/50 dark:hover:bg-slate-850/40 px-2 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 text-xs shrink-0">
                    {projectKey}-{issue.number}
                  </span>
                  <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                    {issue.title}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {issue.story_points != null && (
                    <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300">
                      {issue.story_points} pt
                    </span>
                  )}
                  {sprint.state !== "completed" && (
                    <button
                      className="p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                      aria-label={`Remove ${projectKey}-${issue.number} from ${sprint.name}`}
                      onClick={() =>
                        run(async () => {
                          await send(`/sprints/${sprint.id}/issues/${issue.id}`, session.token, "DELETE");
                          await done("Moved back to the backlog");
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </li>
            ))}
            {open && !detail.isLoading && issues.length === 0 && (
              <li className="py-6 text-center text-xs text-slate-400 italic">
                {sprint.state === "completed"
                  ? "No issues were in this sprint."
                  : "Drag issues here from the backlog, or use “Move to sprint”."}
              </li>
            )}
          </ul>

          {/* Footer Controls */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {sprint.state === "planned" && (
                <button
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors cursor-pointer"
                  onClick={() =>
                    run(async () => {
                      await send(`/sprints/${sprint.id}`, session.token, "PATCH", { state: "active" });
                      await done(`${sprint.name} started`);
                    })
                  }
                >
                  <Play size={13} /> Start sprint
                </button>
              )}

              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() =>
                  downloadCsv(`/sprints/${sprint.id}/export.csv`, session.token, `${sprint.name}.csv`).catch(
                    (e) => setError(errorMessage(e)),
                  )
                }
              >
                <Download size={13} /> Export CSV
              </button>
            </div>

            <div>
              {sprint.state === "active" && !closing && (
                <button
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 transition-colors cursor-pointer"
                  onClick={() => setClosing(true)}
                >
                  <Square size={13} /> Complete sprint
                </button>
              )}

              {sprint.state === "active" && closing && (
                <div className="flex items-center gap-2 flex-wrap bg-slate-50 dark:bg-slate-850 p-2 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="text-xs text-slate-500">Unfinished work to:</span>
                  <select
                    value={carryOver}
                    onChange={(e) => setCarryOver(e.target.value)}
                    className="px-2 py-1 rounded-md text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="backlog">Backlog</option>
                    {carryTargets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="px-3 py-1 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer"
                    onClick={() =>
                      run(async () => {
                        await send(`/sprints/${sprint.id}`, session.token, "PATCH", {
                          state: "completed",
                          carry_over_to: carryOver,
                        });
                        setClosing(false);
                        await done(`${sprint.name} closed`);
                      })
                    }
                  >
                    Confirm close
                  </button>
                  <button
                    className="px-3 py-1 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                    onClick={() => setClosing(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      )}

      {/* Child Modals */}
      {showReport && (
        <SprintReportView sprintId={sprint.id} projectKey={projectKey} onClose={() => setShowReport(false)} />
      )}
      {showCapacity && (
        <SprintCapacityModal
          sprintId={sprint.id}
          sprintName={sprint.name}
          onClose={() => setShowCapacity(false)}
        />
      )}
      {showBoard && (
        <SprintBoardModal
          sprintId={sprint.id}
          sprintName={sprint.name}
          projectKey={projectKey}
          onClose={() => setShowBoard(false)}
        />
      )}
    </Card>
  );
}

type MembershipResultLike = {
  changed: number;
  results: { id: string; ok: boolean; error?: string | null }[];
};
