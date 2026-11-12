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
      <div className="panel-empty" style={{ padding: "36px 16px", textAlign: "center" }}>
        <BarChart3 size={32} className="muted" style={{ marginBottom: 8, opacity: 0.6 }} />
        <p style={{ margin: 0, fontWeight: 500 }}>No completed sprints yet</p>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
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
    <div style={{ position: "relative", width: "100%", overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", minWidth: 540, display: "block" }}
        role="img"
        aria-label="Team Velocity Chart: Commitment vs Completed by Sprint"
      >
        {/* Horizontal grid lines */}
        {ticks.map((tick) => {
          const ty = y(tick);
          return (
            <g key={tick} className="grid-line">
              <line
                x1={pad.l}
                y1={ty}
                x2={W - pad.r}
                y2={ty}
                stroke="var(--border)"
                strokeDasharray={tick === 0 ? undefined : "3 3"}
                strokeWidth={tick === 0 ? 1.5 : 1}
              />
              <text x={pad.l - 8} y={ty + 4} textAnchor="end" fontSize={10} fill="var(--text-3)">
                {tick}
              </text>
            </g>
          );
        })}

        {/* Average Velocity Line */}
        {avgCompleted > 0 && (
          <g className="avg-line">
            <line
              x1={pad.l}
              y1={avgY}
              x2={W - pad.r}
              y2={avgY}
              stroke="#6366f1"
              strokeDasharray="4 4"
              strokeWidth={2}
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
        {sprints.map((s, i) => {
          const cx = pad.l + (i + 0.5) * groupWidth;
          const comm = getCommitted(s);
          const done = getCompleted(s);

          const commH = (comm / maxY) * plotH;
          const doneH = (done / maxY) * plotH;

          const commX = cx - barWidth - barGap / 2;
          const doneX = cx + barGap / 2;

          const commY = pad.t + plotH - commH;
          const doneY = pad.t + plotH - doneH;

          const isHovered = hoveredIdx === i;

          return (
            <g
              key={s.sprint_id}
              className="sprint-bar-group"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {/* Highlight background on hover */}
              {isHovered && (
                <rect
                  x={cx - groupWidth / 2 + 2}
                  y={pad.t}
                  width={groupWidth - 4}
                  height={plotH}
                  fill="var(--accent-subtle, rgba(99, 102, 241, 0.08))"
                  rx={6}
                />
              )}

              {/* Committed Bar */}
              <rect
                x={commX}
                y={commY}
                width={barWidth}
                height={Math.max(2, commH)}
                rx={3}
                fill="#94a3b8"
                opacity={isHovered ? 1 : 0.85}
              />
              {comm > 0 && (
                <text
                  x={commX + barWidth / 2}
                  y={commY - 4}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={500}
                  fill="var(--text-2)"
                >
                  {comm}
                </text>
              )}

              {/* Completed Bar */}
              <rect
                x={doneX}
                y={doneY}
                width={barWidth}
                height={Math.max(2, doneH)}
                rx={3}
                fill="#10b981"
                opacity={isHovered ? 1 : 0.9}
              />
              {done > 0 && (
                <text
                  x={doneX + barWidth / 2}
                  y={doneY - 4}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill="#10b981"
                >
                  {done}
                </text>
              )}

              {/* Sprint label */}
              <text
                x={cx}
                y={pad.t + plotH + 16}
                textAnchor="middle"
                fontSize={11}
                fontWeight={isHovered ? 600 : 500}
                fill={isHovered ? "var(--text-1)" : "var(--text-2)"}
              >
                {s.name.length > 12 ? `${s.name.slice(0, 10)}…` : s.name}
              </text>

              {/* Date label */}
              {s.closed_at && (
                <text x={cx} y={pad.t + plotH + 30} textAnchor="middle" fontSize={9} fill="var(--text-3)">
                  {shortDay(s.closed_at)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hoveredIdx !== null && sprints[hoveredIdx] && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 12px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            fontSize: 12,
            zIndex: 10,
            pointerEvents: "none",
            minWidth: 180,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{sprints[hoveredIdx].name}</div>
          {sprints[hoveredIdx].team_name && (
            <div className="muted small" style={{ marginBottom: 4 }}>
              Team: {sprints[hoveredIdx].team_name}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "#94a3b8" }}>
            <span>Committed:</span>
            <strong>
              {getCommitted(sprints[hoveredIdx])} {isPoints ? "pts" : "issues"}
            </strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "#10b981" }}>
            <span>Completed:</span>
            <strong>
              {getCompleted(sprints[hoveredIdx])} {isPoints ? "pts" : "issues"}
            </strong>
          </div>
          {getFinalScope(sprints[hoveredIdx]) !== getCommitted(sprints[hoveredIdx]) && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "var(--text-3)" }}>
              <span>Final Scope:</span>
              <span>
                {getFinalScope(sprints[hoveredIdx])} (
                {getFinalScope(sprints[hoveredIdx]) - getCommitted(sprints[hoveredIdx]) > 0 ? "+" : ""}
                {getFinalScope(sprints[hoveredIdx]) - getCommitted(sprints[hoveredIdx])})
              </span>
            </div>
          )}
          {sprints[hoveredIdx].carried_over_count != null && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: "var(--text-3)" }}>
              <span>Carried Over:</span>
              <span>{sprints[hoveredIdx].carried_over_count} issues</span>
            </div>
          )}
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              fontWeight: 500,
            }}
          >
            <span>Predictability:</span>
            <span
              style={{
                color:
                  getCommitted(sprints[hoveredIdx]) > 0 &&
                  getCompleted(sprints[hoveredIdx]) / getCommitted(sprints[hoveredIdx]) >= 0.85
                    ? "#10b981"
                    : "#f59e0b",
              }}
            >
              {getCommitted(sprints[hoveredIdx]) > 0
                ? `${Math.round((getCompleted(sprints[hoveredIdx]) / getCommitted(sprints[hoveredIdx])) * 100)}%`
                : "–"}
            </span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 20,
          marginTop: 8,
          fontSize: 12,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              borderRadius: 2,
              background: "#94a3b8",
            }}
          />
          Committed Scope
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              borderRadius: 2,
              background: "#10b981",
            }}
          />
          Completed Scope
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-block",
              width: 18,
              height: 2,
              borderTop: "2px dashed #6366f1",
            }}
          />
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
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Team Velocity & Predictability"
    >
      <div
        className="modal"
        style={{
          maxWidth: 880,
          width: "95vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Header */}
        <div className="modal-head" style={{ marginBottom: 0 }}>
          <div>
            <h3 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
              <BarChart3 size={20} className="accent" />
              Team Velocity &amp; Predictability
            </h3>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              {projectName || projectKey} · Measure commitment reliability, delivery throughput, and sprint
              capacity.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Filters and Controls */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            padding: "8px 12px",
            background: "var(--bg-subtle, rgba(0,0,0,0.03))",
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label className="small" style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <Users size={14} className="muted" /> Team
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                style={{ padding: "4px 8px", fontSize: 13 }}
              >
                <option value="">All Teams (Project Aggregate)</option>
                {(teams.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="small" style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <Calendar size={14} className="muted" /> Window
              <select
                value={sprintWindow}
                onChange={(e) => setSprintWindow(Number(e.target.value))}
                style={{ padding: "4px 8px", fontSize: 13 }}
              >
                <option value={3}>Last 3 sprints</option>
                <option value={5}>Last 5 sprints</option>
                <option value={7}>Last 7 sprints</option>
                <option value={10}>Last 10 sprints</option>
              </select>
            </label>
          </div>

          {/* Metric toggle */}
          <div style={{ display: "flex", gap: 4, background: "var(--border)", padding: 2, borderRadius: 6 }}>
            <button
              className={`small-btn ${metric === "points" ? "primary" : "secondary"}`}
              style={{ padding: "3px 10px", fontSize: 12, border: "none" }}
              onClick={() => setMetric("points")}
            >
              Story Points
            </button>
            <button
              className={`small-btn ${metric === "count" ? "primary" : "secondary"}`}
              style={{ padding: "3px 10px", fontSize: 12, border: "none" }}
              onClick={() => setMetric("count")}
            >
              Issue Count
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Summary KPI Cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 12,
            }}
          >
            <div
              className="stat-card"
              style={{
                padding: 12,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span className="small muted">Average Velocity</span>
                <TrendingUp size={16} color="#10b981" />
              </div>
              <strong style={{ fontSize: 20, color: "#10b981" }}>
                {avgDone.toFixed(1)} {isPoints ? "pts" : "issues"}
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 2 }}>
                Delivered / sprint
              </small>
            </div>

            <div
              className="stat-card"
              style={{
                padding: 12,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span className="small muted">Predictability</span>
                <Target
                  size={16}
                  color={predictability >= 85 ? "#10b981" : predictability >= 70 ? "#f59e0b" : "#ef4444"}
                />
              </div>
              <strong
                style={{
                  fontSize: 20,
                  color: predictability >= 85 ? "#10b981" : predictability >= 70 ? "#f59e0b" : "#ef4444",
                }}
              >
                {Math.round(predictability)}%
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 2 }}>
                Target: 85% - 100%
              </small>
            </div>

            <div
              className="stat-card"
              style={{
                padding: 12,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span className="small muted">Avg Commitment</span>
                <Zap size={16} color="#6366f1" />
              </div>
              <strong style={{ fontSize: 20, color: "#6366f1" }}>
                {avgStarted.toFixed(1)} {isPoints ? "pts" : "issues"}
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 2 }}>
                Planned at sprint start
              </small>
            </div>

            <div
              className="stat-card"
              style={{
                padding: 12,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span className="small muted">Avg Carry-Over</span>
                <AlertCircle size={16} color="#f59e0b" />
              </div>
              <strong style={{ fontSize: 20, color: "#f59e0b" }}>{avgCarriedOver} items</strong>
              <small className="muted" style={{ display: "block", marginTop: 2 }}>
                Unfinished work / sprint
              </small>
            </div>

            <div
              className="stat-card"
              style={{
                padding: 12,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span className="small muted">Recommended Target</span>
                <CheckCircle2 size={16} color="#3b82f6" />
              </div>
              <strong style={{ fontSize: 20, color: "#3b82f6" }}>
                ~{Math.round(avgDone)} {isPoints ? "pts" : "issues"}
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 2 }}>
                For next sprint planning
              </small>
            </div>
          </div>

          {/* Chart Container */}
          <div
            style={{
              padding: 16,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <h4 style={{ margin: 0, fontSize: 14 }}>Commitment vs. Completed Throughput</h4>
              <span className="muted small">
                Showing {sprints.length} completed {sprints.length === 1 ? "sprint" : "sprints"}
              </span>
            </div>

            {velocityQuery.isLoading ? (
              <p className="muted small" style={{ padding: 24, textAlign: "center" }}>
                Loading velocity history…
              </p>
            ) : data ? (
              <TeamVelocityChart velocity={data} metric={metric} height={230} />
            ) : null}
          </div>

          {/* Sprints Breakdown Table */}
          {sprints.length > 0 && (
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Sprint Performance History</h4>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                      <th style={{ padding: "6px 8px" }}>Sprint</th>
                      <th style={{ padding: "6px 8px" }}>Team</th>
                      <th style={{ padding: "6px 8px" }}>Closed</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Committed</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Final Scope</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Completed</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Carried Over</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Predictability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sprints.map((s) => {
                      const comm = isPoints ? (s.started_scope_points ?? 0) : (s.started_scope_count ?? 0);
                      const done = isPoints ? (s.final_done_points ?? 0) : (s.final_done_count ?? 0);
                      const finalScope = isPoints ? (s.final_scope_points ?? 0) : (s.final_scope_count ?? 0);
                      const pred = comm > 0 ? Math.round((done / comm) * 100) : 0;
                      const unit = isPoints ? " pts" : "";

                      return (
                        <tr
                          key={s.sprint_id}
                          style={{ borderBottom: "1px solid var(--border-subtle, rgba(0,0,0,0.05))" }}
                        >
                          <td style={{ padding: "8px 8px", fontWeight: 500 }}>{s.name}</td>
                          <td style={{ padding: "8px 8px" }}>
                            {s.team_name ? (
                              <span className="chip small">{s.team_name}</span>
                            ) : (
                              <span className="muted small">Project</span>
                            )}
                          </td>
                          <td style={{ padding: "8px 8px" }} className="muted small">
                            {shortDay(s.closed_at)}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right", color: "#94a3b8" }}>
                            {comm}
                            {unit}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right" }}>
                            {finalScope}
                            {unit}
                            {finalScope !== comm && (
                              <span
                                style={{
                                  fontSize: 11,
                                  marginLeft: 4,
                                  color: finalScope > comm ? "#ef4444" : "#10b981",
                                }}
                              >
                                ({finalScope > comm ? "+" : ""}
                                {finalScope - comm})
                              </span>
                            )}
                          </td>
                          <td
                            style={{
                              padding: "8px 8px",
                              textAlign: "right",
                              fontWeight: 600,
                              color: "#10b981",
                            }}
                          >
                            {done}
                            {unit}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right" }}>
                            {s.carried_over_count ?? 0}
                          </td>
                          <td style={{ padding: "8px 8px", textAlign: "right" }}>
                            <span
                              className={`chip small ${
                                pred >= 85 ? "success" : pred >= 70 ? "warning" : "danger"
                              }`}
                              style={{
                                display: "inline-block",
                                minWidth: 48,
                                textAlign: "center",
                                fontWeight: 600,
                              }}
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
