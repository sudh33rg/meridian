import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { apiResponse, errorMessage, request, send } from "../../lib/api";
import { downloadCsv } from "../../lib/download";
import { useToast } from "../shared/Toast";
import { formatMinutes } from "./IssueDepth";
import { TeamVelocityChart, TeamVelocityModal } from "./TeamVelocityModal";
import { type Velocity } from "./agile-shared";
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

type FlowRow = { day: string; status: string; count: number };
type CycleReport = {
  completed: number;
  median_lead_days: number | null;
  average_lead_days: number | null;
  median_cycle_days: number | null;
  average_cycle_days: number | null;
  items: {
    issue_id: string;
    number: number;
    title: string;
    done_on: string;
    lead_days: number;
    cycle_days: number | null;
  }[];
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
  if (rows.length === 0)
    return <p className="muted small text-xs text-text-subtle">No data in this range.</p>;
  return (
    <ul className="bars space-y-2 py-1" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-xs">
          <span className="bar-label w-24 sm:w-28 shrink-0 truncate text-text-main font-medium">
            {r.label}
          </span>
          <span className="bar-track flex-1 h-2 bg-bg border border-border rounded-full overflow-hidden">
            <span
              className="bar-fill block h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${Math.round((r.value / max) * 100)}%` }}
            />
          </span>
          <span className="shrink-0 w-8 text-right font-mono text-[11px] text-text-subtle">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Reports on flow, cycle time, created vs resolved, time logged, and custom dashboards. */
export function ReportsPanel() {
  const { session, selected, project, tab, setError, setSelectedIssue } = useWorkspace();
  const qc = useQueryClient();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(thirtyDaysAgo);
  const [to, setTo] = useState(today);
  const [chosen, setChosen] = useState("");
  const [dashName, setDashName] = useState("");
  const [widgetKind, setWidgetKind] = useState("status_counts");
  const [widgetTitle, setWidgetTitle] = useState("");
  const [showVelocityModal, setShowVelocityModal] = useState(false);
  const active = tab === "reports" && !!selected;
  const range = `from=${from}&to=${to}`;
  const velocity = useQuery({
    queryKey: ["velocity-report", selected],
    queryFn: () => request<Velocity>(session.token, `/projects/${selected}/velocity?sprints=5`),
    enabled: active,
  });
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
    queryFn: () =>
      request<CreatedResolved[]>(session.token, `/projects/${selected}/reports/created-resolved?${range}`),
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
    <section className="planning reports space-y-6" aria-labelledby="reports-title">
      <div className="planning-head">
        <PageHeader
          title="Reports"
          subtitle="Built from status history and logged time. Ranges are inclusive, at most a year."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <label className="small flex items-center gap-1.5 text-xs text-text-subtle">
                <span>From</span>
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                  className="px-2 py-1 bg-surface border border-border rounded-lg text-xs text-text-main"
                />
              </label>
              <label className="small flex items-center gap-1.5 text-xs text-text-subtle">
                <span>To</span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                  className="px-2 py-1 bg-surface border border-border rounded-lg text-xs text-text-main"
                />
              </label>
              <button
                className="secondary inline-flex items-center gap-1 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main transition-colors"
                onClick={() =>
                  downloadCsv(`/projects/${selected}/history.csv`, session.token, `${key}-history.csv`).catch(
                    (e) => setError(errorMessage(e)),
                  )
                }
              >
                <Download size={14} /> History CSV
              </button>
              <a
                className="secondary export-link inline-flex items-center gap-1 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main transition-colors cursor-pointer"
                href={`/api/projects/${selected}/export.csv`}
                onClick={(e) => {
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
          }
        />
        <h2 id="reports-title" className="sr-only">
          Reports
        </h2>
      </div>

      <div className="report-grid grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Team Velocity Card */}
        <Card className="panel report-card md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border">
            <CardTitle className="text-base font-bold text-text-main">
              Team Velocity &amp; Predictability
            </CardTitle>
            <button
              className="secondary small-btn px-3 py-1 bg-surface-2 hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main transition-colors"
              onClick={() => setShowVelocityModal(true)}
            >
              Full Velocity Report
            </button>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            <p className="small text-xs sm:text-sm text-text-subtle">
              {velocity.data?.sprints && velocity.data.sprints.length > 0 ? (
                <>
                  <strong className="text-text-main font-semibold">
                    {velocity.data.average_done_points.toFixed(1)} pts
                  </strong>{" "}
                  average over {velocity.data.sprints.length} sprints ·{" "}
                  <strong className="text-text-main font-semibold">
                    {Math.round(velocity.data.predictability_pct)}%
                  </strong>{" "}
                  commitment predictability
                </>
              ) : (
                "No completed sprints with story points recorded yet."
              )}
            </p>
            {velocity.data && velocity.data.sprints.length > 0 ? (
              <div className="pt-2">
                <TeamVelocityChart velocity={velocity.data} metric="points" height={190} />
              </div>
            ) : (
              <p className="muted small text-xs text-text-subtle italic">
                Close a sprint with story points to track team velocity and commitment delivery.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Status Now Card */}
        <Card className="panel report-card">
          <CardHeader className="pb-2 border-b border-border">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle">
              Status now
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <Bars
              label="Issues by status on the last day"
              rows={latest.map((r) => ({ label: statusName(r.status), value: r.count }))}
            />
          </CardContent>
        </Card>

        {/* Cycle Time Card */}
        <Card className="panel report-card">
          <CardHeader className="pb-2 border-b border-border">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle">
              Cycle time
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            <dl className="stat-list grid grid-cols-3 gap-2 p-3 bg-surface-2 rounded-xl text-center border border-border">
              <div>
                <dt className="text-[10px] uppercase font-bold text-text-subtle">Completed</dt>
                <dd className="text-base sm:text-lg font-bold text-text-main mt-0.5">
                  {cycle.data?.completed ?? "–"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase font-bold text-text-subtle">Median lead</dt>
                <dd className="text-base sm:text-lg font-bold text-text-main mt-0.5">
                  {days(cycle.data?.median_lead_days ?? null)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase font-bold text-text-subtle">Median cycle</dt>
                <dd className="text-base sm:text-lg font-bold text-text-main mt-0.5">
                  {days(cycle.data?.median_cycle_days ?? null)}
                </dd>
              </div>
            </dl>
            <Bars
              label="Completed per week"
              rows={(cycle.data?.throughput ?? []).map((t) => ({
                label: `Week of ${t.week}`,
                value: t.completed,
              }))}
            />
          </CardContent>
        </Card>

        {/* Created and Resolved Card */}
        <Card className="panel report-card">
          <CardHeader className="pb-2 border-b border-border">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle">
              Created and resolved
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            <p className="small text-xs text-text-subtle font-medium">
              {issueRange.created} created · {issueRange.resolved} resolved in this range
            </p>
            <Bars
              label="Resolved per day"
              rows={(cr.data ?? [])
                .filter((r) => r.resolved > 0)
                .map((r) => ({ label: r.day, value: r.resolved }))}
            />
          </CardContent>
        </Card>

        {/* Time Logged Card */}
        <Card className="panel report-card">
          <CardHeader className="pb-2 border-b border-border">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle">
              Time logged
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            <p className="small text-xs font-semibold text-text-main">
              Total: {formatMinutes(time.data?.total_minutes ?? 0)}
            </p>
            <Bars
              label="Time by person"
              rows={(time.data?.by_person ?? []).map((p) => ({
                label: p.name,
                value: Math.round(p.minutes / 60),
              }))}
            />
            <p className="muted small text-[11px] text-text-subtle italic">Bars show whole hours.</p>
            <ul className="plain-list divide-y divide-border/60 pt-1">
              {(time.data?.by_issue ?? []).slice(0, 8).map((x) => (
                <li key={x.issue_id} className="small py-1.5 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-1.5 truncate">
                    <button
                      className="issue-number-button shrink-0 font-mono font-bold text-accent hover:underline"
                      onClick={() => setSelectedIssue(x.issue_id)}
                    >
                      {key}-{x.number}
                    </button>
                    <span className="truncate text-text-main font-medium">{x.title}</span>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-text-subtle">
                    {formatMinutes(x.minutes)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Custom Dashboards Section */}
      <Card className="panel dashboards" aria-labelledby="dash-title">
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle id="dash-title" className="text-base font-bold text-text-main">
            Dashboards
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <form
              className="row-actions wrap flex items-center gap-2"
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
              <input
                aria-label="Dashboard name"
                placeholder="New dashboard name"
                value={dashName}
                maxLength={120}
                onChange={(e) => setDashName(e.target.value)}
                className="px-3 py-1.5 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                className="secondary small-btn inline-flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
                disabled={!dashName.trim()}
              >
                <Plus size={14} /> Create
              </button>
            </form>

            <select
              aria-label="Dashboard"
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              className="px-3 py-1.5 bg-surface border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Choose a dashboard…</option>
              {(dashboards.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.shared ? "" : " (private)"}
                </option>
              ))}
            </select>
          </div>

          {chosen && (
            <form
              className="row-actions wrap flex flex-wrap gap-2 p-3 bg-surface-2 rounded-xl border border-border items-center"
              onSubmit={async (e) => {
                e.preventDefault();
                const title =
                  widgetTitle.trim() || WIDGET_KINDS.find((k) => k[0] === widgetKind)?.[1] || "Widget";
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
              <select
                aria-label="Widget kind"
                value={widgetKind}
                onChange={(e) => setWidgetKind(e.target.value)}
                className="px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-main"
              >
                {WIDGET_KINDS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                aria-label="Widget title"
                placeholder="Widget title (optional)"
                value={widgetTitle}
                maxLength={120}
                onChange={(e) => setWidgetTitle(e.target.value)}
                className="flex-1 min-w-[140px] px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-main"
              />
              <button className="secondary small-btn px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-strong transition-colors">
                Add widget
              </button>
            </form>
          )}

          <div className="report-grid grid grid-cols-1 md:grid-cols-2 gap-4">
            {(view.data?.widgets ?? []).map((w) => (
              <article
                key={w.id}
                className="panel report-card p-4 bg-surface-2 rounded-xl border border-border space-y-2"
              >
                <h4 className="text-xs font-bold uppercase tracking-wider text-text-subtle">{w.title}</h4>
                <WidgetBody kind={w.kind} data={w.data} />
              </article>
            ))}
          </div>
        </CardContent>
      </Card>

      {showVelocityModal && selected && (
        <TeamVelocityModal
          projectId={selected}
          projectKey={key}
          projectName={project?.name}
          onClose={() => setShowVelocityModal(false)}
        />
      )}
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
    return (
      <Bars label="Time" rows={rows.map((r) => ({ label: r.name, value: Math.round(r.minutes / 60) }))} />
    );
  }
  if (kind === "cycle_summary") {
    const d = data as {
      completed: number;
      median_lead_days: number | null;
      median_cycle_days: number | null;
    };
    return (
      <p className="small text-xs text-text-subtle">
        {d.completed} completed · median lead{" "}
        {d.median_lead_days == null ? "–" : `${d.median_lead_days.toFixed(1)} d`} · median cycle{" "}
        {d.median_cycle_days == null ? "–" : `${d.median_cycle_days.toFixed(1)} d`}
      </p>
    );
  }
  if (kind === "velocity") {
    const d = data as {
      sprints?: number;
      sprints_count?: number;
      average_done_points: number;
      recent?: { name: string; started_points: number; done_points: number }[];
    };
    const count = d.sprints ?? d.sprints_count ?? 0;
    const recent = d.recent ?? [];
    return (
      <div className="space-y-2">
        <p className="small text-xs font-medium text-text-main">
          <strong>{d.average_done_points.toFixed(1)} pts</strong> average over {count} sprints
        </p>
        {recent.length > 0 && (
          <div className="flex gap-2.5 items-end h-16 py-1">
            {recent.map((s, idx) => {
              const max = Math.max(1, ...recent.map((r) => Math.max(r.started_points, r.done_points)));
              const commH = Math.max(4, (s.started_points / max) * 44);
              const doneH = Math.max(4, (s.done_points / max) * 44);
              return (
                <div
                  key={idx}
                  className="flex-1 flex flex-col items-center"
                  title={`${s.name}: ${s.done_points} done / ${s.started_points} committed`}
                >
                  <div className="flex gap-0.5 items-end h-12">
                    <div className="w-2 bg-slate-400 rounded-xs" style={{ height: commH }} />
                    <div className="w-2 bg-emerald-500 rounded-xs" style={{ height: doneH }} />
                  </div>
                  <span className="text-[9px] text-text-subtle mt-0.5 whitespace-nowrap">
                    {s.name.length > 6 ? `${s.name.slice(0, 5)}…` : s.name}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  if (kind === "flow") {
    return <p className="small muted text-xs text-text-subtle">Flow is shown on the Reports page.</p>;
  }
  return null;
}
