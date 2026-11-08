import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { apiResponse, errorMessage, request, send } from "../../lib/api";
import { downloadCsv } from "../../lib/download";
import { useToast } from "../shared/Toast";
import { formatMinutes } from "./IssueDepth";

type FlowRow = { day: string; status: string; count: number };
type CycleReport = {
  completed: number;
  median_lead_days: number | null;
  average_lead_days: number | null;
  median_cycle_days: number | null;
  average_cycle_days: number | null;
  items: { issue_id: string; number: number; title: string; done_on: string; lead_days: number; cycle_days: number | null }[];
  throughput: { week: string; completed: number }[];
};
type CreatedResolved = { day: string; created: number; resolved: number };
type TimeReport = {
  total_minutes: number;
  by_person: { user_id: string; name: string; minutes: number }[];
  by_issue: { issue_id: string; number: number; title: string; minutes: number }[];
};
type Dashboard = { id: string; name: string; shared: boolean; owner_id: string };
type DashboardView = {
  dashboard: Dashboard;
  widgets: { id: string; kind: string; title: string; data: unknown }[];
};

const WIDGET_KINDS = [
  ["status_counts", "Issues by status"],
  ["priority_counts", "Issues by priority"],
  ["assignee_counts", "Open issues by assignee"],
  ["time_by_person", "Time by person (last 30 days)"],
  ["cycle_summary", "Cycle time summary (last 30 days)"],
  ["velocity", "Velocity (last 5 sprints)"],
] as const;

function Bars({ rows, label }: { rows: { label: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="muted small">No data in this range.</p>;
  return (
    <ul className="bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.round((r.value / max) * 100)}%` }} />
          </span>
          <span className="small">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Reports (flow, cycle time, created versus resolved, time) and dashboards built from widgets. */
export function ReportsPanel() {
  const { session, selected, project, tab, setError, setSelectedIssue } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [dashName, setDashName] = useState("");
  const [chosen, setChosen] = useState("");
  const [widgetKind, setWidgetKind] = useState<string>(WIDGET_KINDS[0][0]);
  const [widgetTitle, setWidgetTitle] = useState("");
  const active = tab === "reports" && !!selected;
  const range = `from=${from}&to=${to}`;
  const flow = useQuery({
    queryKey: ["report", "flow", selected, from, to],
    queryFn: () => request<FlowRow[]>(session.token, `/projects/${selected}/reports/flow?${range}`),
    enabled: active,
  });
  const cycle = useQuery({
    queryKey: ["report", "cycle", selected, from, to],
    queryFn: () => request<CycleReport>(session.token, `/projects/${selected}/reports/cycle-time?${range}`),
    enabled: active,
  });
  const cr = useQuery({
    queryKey: ["report", "created", selected, from, to],
    queryFn: () => request<CreatedResolved[]>(session.token, `/projects/${selected}/reports/created-resolved?${range}`),
    enabled: active,
  });
  const time = useQuery({
    queryKey: ["report", "time", selected, from, to],
    queryFn: () => request<TimeReport>(session.token, `/projects/${selected}/reports/time?${range}`),
    enabled: active,
  });
  const statuses = useQuery({
    queryKey: ["statuses", selected],
    queryFn: () => request<{ key: string; name: string }[]>(session.token, `/projects/${selected}/statuses`),
    enabled: active,
  });
  const dashboards = useQuery({
    queryKey: ["dashboards", selected],
    queryFn: () => request<Dashboard[]>(session.token, `/projects/${selected}/dashboards`),
    enabled: active,
  });
  const view = useQuery({
    queryKey: ["dashboard", chosen],
    queryFn: () => request<DashboardView>(session.token, `/dashboards/${chosen}`),
    enabled: active && !!chosen,
  });
  if (!active) return null;

  const key = project?.key ?? "";
  const statusName = (k: string) => statuses.data?.find((x) => x.key === k)?.name ?? k;
  const lastDay = (flow.data ?? []).length ? flow.data![flow.data!.length - 1].day : "";
  const latest = (flow.data ?? []).filter((r) => r.day === lastDay);
  const issueRange = (cr.data ?? []).reduce(
    (acc, r) => ({ created: acc.created + r.created, resolved: acc.resolved + r.resolved }),
    { created: 0, resolved: 0 },
  );
  const invalidate = () => qc.invalidateQueries({ queryKey: ["dashboards", selected] });
  const days = (n: number | null) => (n == null ? "–" : `${n.toFixed(1)} d`);

  return (
    <section className="planning reports" aria-labelledby="reports-title">
      <div className="planning-head">
        <div>
          <h2 id="reports-title">Reports</h2>
          <p className="muted small">Built from status history and logged time. Ranges are inclusive, at most a year.</p>
        </div>
        <label className="small">
          From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="small">
          To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          className="secondary"
          onClick={() =>
            downloadCsv(`/projects/${selected}/history.csv`, session.token, `${key}-history.csv`).catch((e) =>
              setError(errorMessage(e)),
            )
          }
        >
          <Download size={14} /> History CSV
        </button>
        <a
          className="secondary export-link"
          href={`/api/projects/${selected}/export.csv`}
          onClick={(e) => {
            // The API needs the bearer or cookie session; fetch it and save the file instead of navigating.
            e.preventDefault();
            apiResponse(`/projects/${selected}/export.csv`, session.token)
              .then((r) => r.blob())
              .then((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${key}-issues.csv`;
                a.click();
                URL.revokeObjectURL(url);
              })
              .catch((err) => setError(errorMessage(err)));
          }}
        >
          <Download size={14} /> Export CSV
        </a>
      </div>

      <div className="report-grid">
        <article className="panel report-card">
          <h3>Status now</h3>
          <Bars
            label="Issues by status on the last day"
            rows={latest.map((r) => ({ label: statusName(r.status), value: r.count }))}
          />
        </article>
        <article className="panel report-card">
          <h3>Cycle time</h3>
          <dl className="stat-list">
            <div>
              <dt>Completed</dt>
              <dd>{cycle.data?.completed ?? "–"}</dd>
            </div>
            <div>
              <dt>Median lead time</dt>
              <dd>{days(cycle.data?.median_lead_days ?? null)}</dd>
            </div>
            <div>
              <dt>Median cycle time</dt>
              <dd>{days(cycle.data?.median_cycle_days ?? null)}</dd>
            </div>
          </dl>
          <Bars
            label="Completed per week"
            rows={(cycle.data?.throughput ?? []).map((t) => ({ label: `Week of ${t.week}`, value: t.completed }))}
          />
        </article>
        <article className="panel report-card">
          <h3>Created and resolved</h3>
          <p className="small">
            {issueRange.created} created · {issueRange.resolved} resolved in this range
          </p>
          <Bars
            label="Resolved per day"
            rows={(cr.data ?? []).filter((r) => r.resolved > 0).map((r) => ({ label: r.day, value: r.resolved }))}
          />
        </article>
        <article className="panel report-card">
          <h3>Time logged</h3>
          <p className="small">Total {formatMinutes(time.data?.total_minutes ?? 0)}</p>
          <Bars
            label="Time by person"
            rows={(time.data?.by_person ?? []).map((p) => ({ label: p.name, value: Math.round(p.minutes / 60) }))}
          />
          <p className="muted small">Bars show whole hours.</p>
          <ul className="plain-list">
            {(time.data?.by_issue ?? []).slice(0, 8).map((x) => (
              <li key={x.issue_id} className="small">
                <button className="issue-number-button" onClick={() => setSelectedIssue(x.issue_id)}>
                  {key}-{x.number}
                </button>{" "}
                {x.title} · {formatMinutes(x.minutes)}
              </li>
            ))}
          </ul>
        </article>
      </div>

      <section className="panel dashboards" aria-labelledby="dash-title">
        <h3 id="dash-title">Dashboards</h3>
        <form
          className="row-actions wrap"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!dashName.trim() || !selected) return;
            try {
              const d = await send<Dashboard>(`/projects/${selected}/dashboards`, session.token, "POST", {
                name: dashName.trim(),
                shared: true,
              });
              setDashName("");
              setChosen(d.id);
              toast("Dashboard created");
              await invalidate();
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <input aria-label="Dashboard name" placeholder="New dashboard name" value={dashName} maxLength={120} onChange={(e) => setDashName(e.target.value)} />
          <button className="secondary small-btn" disabled={!dashName.trim()}>
            <Plus size={14} /> Create
          </button>
        </form>
        <div className="row-actions wrap">
          <select aria-label="Dashboard" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            <option value="">Choose a dashboard…</option>
            {(dashboards.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.shared ? "" : " (private)"}
              </option>
            ))}
          </select>
          {chosen && (
            <form
              className="row-actions wrap"
              onSubmit={async (e) => {
                e.preventDefault();
                const title = widgetTitle.trim() || WIDGET_KINDS.find((k) => k[0] === widgetKind)?.[1] || "Widget";
                try {
                  await send(`/dashboards/${chosen}/widgets`, session.token, "POST", {
                    kind: widgetKind,
                    title,
                    config: { from, to },
                  });
                  setWidgetTitle("");
                  await qc.invalidateQueries({ queryKey: ["dashboard", chosen] });
                } catch (err) {
                  setError(errorMessage(err));
                }
              }}
            >
              <select aria-label="Widget kind" value={widgetKind} onChange={(e) => setWidgetKind(e.target.value)}>
                {WIDGET_KINDS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <input aria-label="Widget title" placeholder="Widget title (optional)" value={widgetTitle} maxLength={120} onChange={(e) => setWidgetTitle(e.target.value)} />
              <button className="secondary small-btn">Add widget</button>
            </form>
          )}
        </div>
        <div className="report-grid">
          {(view.data?.widgets ?? []).map((w) => (
            <article key={w.id} className="panel report-card">
              <h4>{w.title}</h4>
              <WidgetBody kind={w.kind} data={w.data} />
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function WidgetBody({ kind, data }: { kind: string; data: unknown }) {
  if (kind === "status_counts" || kind === "priority_counts" || kind === "assignee_counts") {
    const rows = (data as { key: string; count: number }[]) ?? [];
    return <Bars label="Counts" rows={rows.map((r) => ({ label: r.key, value: r.count }))} />;
  }
  if (kind === "time_by_person") {
    const rows = (data as { name: string; minutes: number }[]) ?? [];
    return <Bars label="Time" rows={rows.map((r) => ({ label: r.name, value: Math.round(r.minutes / 60) }))} />;
  }
  if (kind === "cycle_summary") {
    const d = data as { completed: number; median_lead_days: number | null; median_cycle_days: number | null };
    return (
      <p className="small">
        {d.completed} completed · median lead {d.median_lead_days == null ? "–" : `${d.median_lead_days.toFixed(1)} d`} · median cycle{" "}
        {d.median_cycle_days == null ? "–" : `${d.median_cycle_days.toFixed(1)} d`}
      </p>
    );
  }
  if (kind === "velocity") {
    const d = data as { sprints: number; average_done_points: number };
    return <p className="small">{d.average_done_points.toFixed(1)} points average over {d.sprints} sprints</p>;
  }
  if (kind === "flow") {
    return <p className="small muted">Flow is shown on the Reports page.</p>;
  }
  return null;
}
