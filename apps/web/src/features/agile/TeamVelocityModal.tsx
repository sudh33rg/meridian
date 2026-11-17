import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  TrendingUp,
  X,
  Target,
  Zap,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Users,
} from "lucide-react";
import { request } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { type Velocity, shortDay, useTeams } from "./agile-shared";

export type MetricType = "points" | "count";

export function TeamVelocityChart({
  velocity,
  metric = "points",
  height = 240,
}: {
  velocity: Velocity;
  metric?: MetricType;
  height?: number;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Sprints in chronological order (API returns closed_at DESC, so reverse for chart timeline)
  const sprints = [...velocity.sprints].reverse();

  if (sprints.length === 0) {
    return (
      <div className="panel-empty py-10 px-4 text-center flex flex-col items-center justify-center">
        <BarChart3 size={32} className="text-muted mb-2 opacity-60" />
        <p className="font-semibold text-text text-sm">No completed sprints yet</p>
        <p className="text-xs text-muted mt-1 max-w-sm">
          Close an active sprint with story points to record historical velocity.
        </p>
      </div>
    );
  }

  const isPoints = metric === "points";

  const getCommitted = (s: (typeof sprints)[0]) =>
    isPoints ? (s.started_scope_points ?? 0) : (s.started_scope_count ?? 0);
  const getCompleted = (s: (typeof sprints)[0]) =>
    isPoints ? (s.final_done_points ?? 0) : (s.final_done_count ?? 0);
  const getFinalScope = (s: (typeof sprints)[0]) =>
    isPoints ? (s.final_scope_points ?? 0) : (s.final_scope_count ?? 0);

  const avgCompleted = isPoints ? velocity.average_done_points || 0 : velocity.average_done_count || 0;

  const W = 680;
  const H = height;
  const pad = { l: 45, r: 65, t: 24, b: 42 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const maxVal = Math.max(
    10,
    ...sprints.map((s) => Math.max(getCommitted(s), getCompleted(s), getFinalScope(s))),
    Math.ceil(avgCompleted * 1.15),
  );

  // Round maxVal up to a neat multiple
  const maxY = Math.ceil(maxVal / 5) * 5;

  const y = (val: number) => pad.t + plotH - (Math.max(0, val) / maxY) * plotH;

  const groupWidth = plotW / sprints.length;
  const barWidth = Math.min(28, Math.max(12, (groupWidth - 24) / 2));
  const barGap = 4;

  const avgY = y(avgCompleted);

  // Grid tick counts
  const ticks = [0, Math.round(maxY * 0.33), Math.round(maxY * 0.66), maxY];

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[540px] block"
        role="img"
        aria-label="Team Velocity Chart: Commitment vs Completed by Sprint"
      >
        {/* Horizontal grid lines */}
        {ticks.map((tick) => {
          const ty = y(tick);
          return (
            <g key={tick} className="grid-line opacity-20 dark:opacity-30">
              <line
                x1={pad.l}
                y1={ty}
                x2={W - pad.r}
                y2={ty}
                stroke="currentColor"
                strokeDasharray={tick === 0 ? undefined : "3,3"}
              />
              <text
                x={pad.l - 8}
                y={ty + 4}
                textAnchor="end"
                fontSize={10}
                fill="currentColor"
                className="text-muted opacity-80"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Average line */}
        {avgCompleted > 0 && (
          <g>
            <line
              x1={pad.l}
              y1={avgY}
              x2={W - pad.r}
              y2={avgY}
              stroke="#6366f1"
              strokeWidth={1.5}
              strokeDasharray="4,4"
            />
            <rect x={W - pad.r + 4} y={avgY - 9} width={54} height={18} rx={4} fill="#6366f1" />
            <text
              x={W - pad.r + 31}
              y={avgY + 3}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              fill="#ffffff"
            >
              Avg {Math.round(avgCompleted)}
            </text>
          </g>
        )}

        {/* Sprint Bars */}
        {sprints.map((s, idx) => {
          const groupCenter = pad.l + idx * groupWidth + groupWidth / 2;
          const commVal = getCommitted(s);
          const doneVal = getCompleted(s);

          const commX = groupCenter - barWidth - barGap / 2;
          const doneX = groupCenter + barGap / 2;

          const commY = y(commVal);
          const doneY = y(doneVal);
          const commH = pad.t + plotH - commY;
          const doneH = pad.t + plotH - doneY;

          const isHovered = hoveredIdx === idx;

          return (
            <g
              key={s.sprint_id}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {/* Highlight background on hover */}
              {isHovered && (
                <rect
                  x={pad.l + idx * groupWidth + 2}
                  y={pad.t}
                  width={groupWidth - 4}
                  height={plotH}
                  fill="currentColor"
                  className="text-accent/10"
                  rx={4}
                />
              )}

              {/* Committed Bar */}
              <rect
                x={commX}
                y={commY}
                width={barWidth}
                height={Math.max(1, commH)}
                fill="#94a3b8"
                rx={2}
                opacity={isHovered ? 1 : 0.85}
              />

              {/* Completed Bar */}
              <rect
                x={doneX}
                y={doneY}
                width={barWidth}
                height={Math.max(1, doneH)}
                fill="#10b981"
                rx={2}
                opacity={isHovered ? 1 : 0.9}
              />

              {/* Values above bars on hover */}
              {isHovered && (
                <>
                  <text
                    x={commX + barWidth / 2}
                    y={Math.max(pad.t + 10, commY - 3)}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#64748b"
                    fontWeight={600}
                  >
                    {commVal}
                  </text>
                  <text
                    x={doneX + barWidth / 2}
                    y={Math.max(pad.t + 10, doneY - 3)}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#10b981"
                    fontWeight={600}
                  >
                    {doneVal}
                  </text>
                </>
              )}

              {/* Sprint label under chart */}
              <text
                x={groupCenter}
                y={H - pad.b + 14}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
                className="text-muted font-medium"
              >
                {s.name.length > 12 ? `${s.name.slice(0, 10)}…` : s.name}
              </text>
              <text
                x={groupCenter}
                y={H - pad.b + 26}
                textAnchor="middle"
                fontSize={9}
                fill="currentColor"
                className="text-muted opacity-60"
              >
                {shortDay(s.closed_at)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-5 mt-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-xs bg-text-subtle" />
          Committed Scope
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-xs bg-emerald-500" />
          Completed Scope
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4.5 h-0.5 border-t-2 border-dashed border-accent" />
          Average Velocity
        </span>
      </div>
    </div>
  );
}

export function TeamVelocityModal({
  projectId,
  projectKey,
  projectName,
  initialTeamId = "",
  onClose,
}: {
  projectId: string;
  projectKey: string;
  projectName?: string;
  initialTeamId?: string;
  onClose: () => void;
}) {
  const { session } = useWorkspace();
  const [teamFilter, setTeamFilter] = useState(initialTeamId);
  const [sprintWindow, setSprintWindow] = useState<number>(5);
  const [metric, setMetric] = useState<MetricType>("points");

  const teams = useTeams(session.token, true);

  const velocityQuery = useQuery({
    queryKey: ["velocity-deep", projectId, teamFilter, sprintWindow],
    queryFn: () => {
      const q = new URLSearchParams({ sprints: String(sprintWindow) });
      if (teamFilter) q.set("team_id", teamFilter);
      return request<Velocity>(session.token, `/projects/${projectId}/velocity?${q.toString()}`);
    },
  });

  const data = velocityQuery.data;
  const isPoints = metric === "points";

  const sprints = data?.sprints ?? [];
  const avgDone = isPoints ? (data?.average_done_points ?? 0) : (data?.average_done_count ?? 0);
  const avgStarted = isPoints ? (data?.average_started_points ?? 0) : (data?.average_started_count ?? 0);
  const predictability = data?.predictability_pct ?? 0;

  const totalCarriedOver = sprints.reduce((acc, s) => acc + (s.carried_over_count ?? 0), 0);
  const avgCarriedOver = sprints.length > 0 ? (totalCarriedOver / sprints.length).toFixed(1) : "0";

  return (
    <div
      className="overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Team Velocity & Predictability"
    >
      <div className="modal max-w-4xl w-full max-h-[90vh] flex flex-col gap-4 p-4 sm:p-6 bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="modal-head flex items-start justify-between gap-4 pb-2 border-b border-border">
          <div>
            <h3 className="flex items-center gap-2 text-base sm:text-lg font-bold text-text">
              <BarChart3 size={20} className="accent text-accent" />
              Team Velocity &amp; Predictability
            </h3>
            <p className="text-xs sm:text-sm text-muted mt-0.5">
              {projectName || projectKey} · Measure commitment reliability, delivery throughput, and sprint
              capacity.
            </p>
          </div>
          <button
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer inline-grid place-items-center"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filters and Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-surface-2 rounded-xl border border-border">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-medium text-text">
              <Users size={14} className="text-muted" /> Team
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-border bg-surface text-text text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">All Teams (Project Aggregate)</option>
                {(teams.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-xs font-medium text-text">
              <Calendar size={14} className="text-muted" /> Window
              <select
                value={sprintWindow}
                onChange={(e) => setSprintWindow(Number(e.target.value))}
                className="px-2.5 py-1.5 rounded-lg border border-border bg-surface text-text text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value={3}>Last 3 sprints</option>
                <option value={5}>Last 5 sprints</option>
                <option value={7}>Last 7 sprints</option>
                <option value={10}>Last 10 sprints</option>
              </select>
            </label>
          </div>

          {/* Metric toggle */}
          <div className="inline-flex p-0.5 rounded-lg bg-surface border border-border">
            <button
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer min-h-[30px] ${
                metric === "points" ? "bg-accent text-white shadow-xs" : "text-muted hover:text-text"
              }`}
              onClick={() => setMetric("points")}
            >
              Story Points
            </button>
            <button
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer min-h-[30px] ${
                metric === "count" ? "bg-accent text-white shadow-xs" : "text-muted hover:text-text"
              }`}
              onClick={() => setMetric("count")}
            >
              Issue Count
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="overflow-y-auto space-y-4 pr-1">
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="stat-card p-3 bg-surface border border-border rounded-xl">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-muted font-medium">Average Velocity</span>
                <TrendingUp size={16} className="text-emerald-500" />
              </div>
              <strong className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400 block">
                {avgDone.toFixed(1)} {isPoints ? "pts" : "issues"}
              </strong>
              <small className="text-[11px] text-muted block mt-0.5">Delivered / sprint</small>
            </div>

            <div className="stat-card p-3 bg-surface border border-border rounded-xl">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-muted font-medium">Predictability</span>
                <Target
                  size={16}
                  className={
                    predictability >= 85
                      ? "text-emerald-500"
                      : predictability >= 70
                        ? "text-amber-500"
                        : "text-rose-500"
                  }
                />
              </div>
              <strong
                className={`text-base sm:text-lg font-bold block ${
                  predictability >= 85
                    ? "text-emerald-600 dark:text-emerald-400"
                    : predictability >= 70
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {Math.round(predictability)}%
              </strong>
              <small className="text-[11px] text-muted block mt-0.5">Target: 85% - 100%</small>
            </div>

            <div className="stat-card p-3 bg-surface border border-border rounded-xl">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-muted font-medium">Avg Commitment</span>
                <Zap size={16} className="text-accent" />
              </div>
              <strong className="text-base sm:text-lg font-bold text-accent block">
                {avgStarted.toFixed(1)} {isPoints ? "pts" : "issues"}
              </strong>
              <small className="text-[11px] text-muted block mt-0.5">Planned at sprint start</small>
            </div>

            <div className="stat-card p-3 bg-surface border border-border rounded-xl">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-muted font-medium">Avg Carry-Over</span>
                <AlertCircle size={16} className="text-amber-500" />
              </div>
              <strong className="text-base sm:text-lg font-bold text-amber-600 dark:text-amber-400 block">
                {avgCarriedOver} items
              </strong>
              <small className="text-[11px] text-muted block mt-0.5">Unfinished work / sprint</small>
            </div>

            <div className="stat-card p-3 bg-surface border border-border rounded-xl col-span-2 sm:col-span-1">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-muted font-medium">Target</span>
                <CheckCircle2 size={16} className="text-blue-500" />
              </div>
              <strong className="text-base sm:text-lg font-bold text-blue-600 dark:text-blue-400 block">
                ~{Math.round(avgDone)} {isPoints ? "pts" : "issues"}
              </strong>
              <small className="text-[11px] text-muted block mt-0.5">For next sprint planning</small>
            </div>
          </div>

          {/* Chart Container */}
          <div className="p-4 bg-surface border border-border rounded-xl">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-xs sm:text-sm font-semibold text-text">
                Commitment vs. Completed Throughput
              </h4>
              <span className="text-xs text-muted">
                Showing {sprints.length} completed {sprints.length === 1 ? "sprint" : "sprints"}
              </span>
            </div>

            {velocityQuery.isLoading ? (
              <p className="text-xs text-muted text-center py-8">Loading velocity history…</p>
            ) : data ? (
              <TeamVelocityChart velocity={data} metric={metric} height={230} />
            ) : null}
          </div>

          {/* Sprints Breakdown Table */}
          {sprints.length > 0 && (
            <div className="p-4 bg-surface border border-border rounded-xl space-y-3">
              <h4 className="text-xs sm:text-sm font-semibold text-text">Sprint Performance History</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-border text-muted font-medium">
                      <th className="py-2 px-2.5">Sprint</th>
                      <th className="py-2 px-2.5">Team</th>
                      <th className="py-2 px-2.5">Closed</th>
                      <th className="py-2 px-2.5 text-right">Committed</th>
                      <th className="py-2 px-2.5 text-right">Final Scope</th>
                      <th className="py-2 px-2.5 text-right">Completed</th>
                      <th className="py-2 px-2.5 text-right">Carried Over</th>
                      <th className="py-2 px-2.5 text-right">Predictability</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sprints.map((s) => {
                      const comm = isPoints ? (s.started_scope_points ?? 0) : (s.started_scope_count ?? 0);
                      const done = isPoints ? (s.final_done_points ?? 0) : (s.final_done_count ?? 0);
                      const finalScope = isPoints ? (s.final_scope_points ?? 0) : (s.final_scope_count ?? 0);
                      const pred = comm > 0 ? Math.round((done / comm) * 100) : 0;
                      const unit = isPoints ? " pts" : "";

                      return (
                        <tr key={s.sprint_id} className="hover:bg-surface-2 transition-colors">
                          <td className="py-2 px-2.5 font-semibold text-text">{s.name}</td>
                          <td className="py-2 px-2.5">
                            {s.team_name ? (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-2 text-text border border-border capitalize whitespace-nowrap">
                                {s.team_name}
                              </span>
                            ) : (
                              <span className="text-muted text-[11px]">Project</span>
                            )}
                          </td>
                          <td className="py-2 px-2.5 text-muted">{shortDay(s.closed_at)}</td>
                          <td className="py-2 px-2.5 text-right text-muted">
                            {comm}
                            {unit}
                          </td>
                          <td className="py-2 px-2.5 text-right text-text">
                            {finalScope}
                            {unit}
                            {finalScope !== comm && (
                              <span
                                className={`text-[11px] ml-1 font-medium ${
                                  finalScope > comm ? "text-rose-500" : "text-emerald-500"
                                }`}
                              >
                                ({finalScope > comm ? "+" : ""}
                                {finalScope - comm})
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2.5 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                            {done}
                            {unit}
                          </td>
                          <td className="py-2 px-2.5 text-right text-muted">{s.carried_over_count ?? 0}</td>
                          <td className="py-2 px-2.5 text-right">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-bold inline-block min-w-[48px] text-center capitalize whitespace-nowrap ${
                                pred >= 85
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                  : pred >= 70
                                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                              }`}
                            >
                              {comm > 0 ? `${pred}%` : "–"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
