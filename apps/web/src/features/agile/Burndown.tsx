import React from "react";
import type { Burndown as BurndownData } from "./agile-shared";
import { shortDay } from "./agile-shared";

/** Remaining points per day (burndown) with the ideal line, and scope per day (burnup). */
export function Burndown({ data }: { data: BurndownData }) {
  const days = [...data.snapshots];
  if (!days.some((d) => d.day === data.today)) {
    days.push({ day: data.today, ...data.current });
  }
  if (days.length === 0) {
    return <p className="muted small">No burndown yet. The first point is recorded when the sprint starts.</p>;
  }
  const W = 320;
  const H = 150;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const maxY = Math.max(1, ...days.map((d) => Math.max(d.scope_points, d.done_points)));
  const remaining = (d: { scope_points: number; done_points: number }) => d.scope_points - d.done_points;
  const startRemaining = remaining(days[0]);
  const x = (i: number) => pad.l + (days.length === 1 ? 0 : (i / (days.length - 1)) * plotW);
  const y = (v: number) => pad.t + plotH - (v / maxY) * plotH;
  const burn = days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(remaining(d)).toFixed(1)}`).join(" ");
  const ideal = days
    .map((_, i) => {
      const v = days.length === 1 ? 0 : startRemaining * (1 - i / (days.length - 1));
      return `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    })
    .join(" ");
  const scope = days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.scope_points).toFixed(1)}`).join(" ");
  const last = days[days.length - 1];
  return (
    <figure className="burndown">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Burndown: ${remaining(last)} points remaining of ${last.scope_points} on ${shortDay(last.day)}`}
        width="100%"
      >
        <line x1={pad.l} y1={pad.t + plotH} x2={W - pad.r} y2={pad.t + plotH} className="bd-axis" />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + plotH} className="bd-axis" />
        <text x={pad.l - 4} y={pad.t + 4} textAnchor="end" className="bd-label">
          {maxY}
        </text>
        <text x={pad.l - 4} y={pad.t + plotH} textAnchor="end" className="bd-label">
          0
        </text>
        <path d={ideal} className="bd-ideal" fill="none" />
        <path d={scope} className="bd-scope" fill="none" />
        <path d={burn} className="bd-burn" fill="none" />
        {days.map((d, i) => (
          <circle key={d.day} cx={x(i)} cy={y(remaining(d))} r={2.5} className="bd-dot" />
        ))}
        <text x={pad.l} y={H - 6} className="bd-label">
          {shortDay(days[0].day)}
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" className="bd-label">
          {shortDay(last.day)}
        </text>
      </svg>
      <figcaption className="small muted">
        Remaining {remaining(last)} of {last.scope_points} pts · done {last.done_points} pts · scope{" "}
        {last.scope_count} issues
        {data.current.scope_points !== (days[0]?.scope_points ?? data.current.scope_points)
          ? ` · scope changed by ${data.current.scope_points - days[0].scope_points} pts`
          : ""}
      </figcaption>
    </figure>
  );
}
