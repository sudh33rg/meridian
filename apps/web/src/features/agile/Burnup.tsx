import React from "react";
import { shortDay } from "./agile-shared";

export type BurnupData = {
  sprint_id: string;
  state: string;
  snapshots: {
    day: string;
    total_scope_points: number;
    completed_points: number;
    total_scope_count: number;
    completed_count: number;
  }[];
  current: {
    scope_points: number;
    done_points: number;
    scope_count: number;
    done_count: number;
  };
  today: string;
};

/** Scope points and completed points over sprint timeline (burnup). */
export function Burnup({ data }: { data: BurnupData }) {
  const days = [...data.snapshots];
  if (!days.some((d) => d.day === data.today)) {
    days.push({
      day: data.today,
      total_scope_points: data.current.scope_points,
      completed_points: data.current.done_points,
      total_scope_count: data.current.scope_count,
      completed_count: data.current.done_count,
    });
  }
  if (days.length === 0) {
    return <p className="muted small">No burnup data yet. Recorded when the sprint starts.</p>;
  }

  const W = 320;
  const H = 150;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const maxY = Math.max(1, ...days.map((d) => Math.max(d.total_scope_points, d.completed_points)));
  const x = (i: number) => pad.l + (days.length === 1 ? 0 : (i / (days.length - 1)) * plotW);
  const y = (v: number) => pad.t + plotH - (v / maxY) * plotH;

  const scopePath = days
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.total_scope_points).toFixed(1)}`)
    .join(" ");
  const completedPath = days
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.completed_points).toFixed(1)}`)
    .join(" ");

  const last = days[days.length - 1];

  return (
    <figure className="burnup" style={{ margin: "12px 0" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Burnup: ${last.completed_points} points done of ${last.total_scope_points} scope on ${shortDay(last.day)}`}
        width="100%"
      >
        <line x1={pad.l} y1={pad.t + plotH} x2={W - pad.r} y2={pad.t + plotH} className="bd-axis" stroke="currentColor" opacity={0.2} />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + plotH} className="bd-axis" stroke="currentColor" opacity={0.2} />
        <text x={pad.l - 4} y={pad.t + 4} textAnchor="end" className="bd-label" fontSize="10" fill="currentColor">
          {maxY}
        </text>
        <text x={pad.l - 4} y={pad.t + plotH} textAnchor="end" className="bd-label" fontSize="10" fill="currentColor">
          0
        </text>
        {/* Scope line (blue dashed) */}
        <path d={scopePath} fill="none" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 2" />
        {/* Completed line (green solid) */}
        <path d={completedPath} fill="none" stroke="#10b981" strokeWidth={2} />
        {days.map((d, i) => (
          <circle key={d.day} cx={x(i)} cy={y(d.completed_points)} r={2.5} fill="#10b981" />
        ))}
        <text x={pad.l} y={H - 6} className="bd-label" fontSize="10" fill="currentColor">
          {shortDay(days[0].day)}
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" className="bd-label" fontSize="10" fill="currentColor">
          {shortDay(last.day)}
        </text>
      </svg>
      <figcaption className="small muted" style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
        <span><strong style={{ color: "#3b82f6" }}>--</strong> Total Scope: {last.total_scope_points} pts</span>
        <span><strong style={{ color: "#10b981" }}>—</strong> Completed: {last.completed_points} pts</span>
      </figcaption>
    </figure>
  );
}
