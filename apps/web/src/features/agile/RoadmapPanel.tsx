import { formatDate } from "../../lib/datetime";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { formatMinutes } from "./IssueDepth";
import { PortfolioOverviewView } from "./PortfolioOverviewView";
import { RaidRegisterView } from "./RaidRegisterView";
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

type Timeline = {
  kind: string;
  id: string;
  name: string;
  start: string | null;
  end: string | null;
  status: string | null;
  progress: number | null;
};
type Milestone = { id: string; name: string; target_on: string; reached_on: string | null };
type Critical = {
  path: { issue_id: string; number: number; title: string; minutes: number }[];
  total_minutes: number;
  has_cycle: boolean;
};
type Update = { id: string; author_name: string; health: string; body: string; created_at: string };
type Initiative = {
  id: string;
  name: string;
  status: string;
  target_on: string | null;
  epics: number;
  epics_done: number;
};
type Capacity = {
  user_id: string;
  name: string;
  hours_per_week: number | null;
  open_issues: number;
  remaining_hours: number;
  utilisation_pct: number | null;
};
type Baseline = { id: string; name: string; items: number; created_at: string };
type Variance = {
  issue_id: string;
  number: number;
  title: string;
  variance_days: number | null;
  done: boolean;
};

const HEALTH: Record<string, string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track" };

/** Roadmap, portfolio, capacity and baselines for one project, plus the workspace's initiatives. */
export function RoadmapPanel() {
  const { session, selected, project, tab, setError, setSelectedIssue } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const token = session.token;
  const active = tab === "roadmap" && !!selected;
  const [subView, setSubView] = useState<"roadmap" | "portfolio" | "raid">("roadmap");
  const [msName, setMsName] = useState("");
  const [msDate, setMsDate] = useState("");
  const [health, setHealth] = useState("on_track");
  const [body, setBody] = useState("");
  const [initName, setInitName] = useState("");
  const [initDate, setInitDate] = useState("");
  const [baseName, setBaseName] = useState("");
  const [baseChoice, setBaseChoice] = useState("");
  const [epicPick, setEpicPick] = useState("");
  const [initPick, setInitPick] = useState("");
  const timeline = useQuery({
    queryKey: ["timeline", selected],
    queryFn: () => request<Timeline[]>(token, `/projects/${selected}/timeline`),
    enabled: active,
  });
  const milestones = useQuery({
    queryKey: ["milestones", selected],
    queryFn: () => request<Milestone[]>(token, `/projects/${selected}/milestones`),
    enabled: active,
  });
  const critical = useQuery({
    queryKey: ["critical", selected],
    queryFn: () => request<Critical>(token, `/projects/${selected}/critical-path`),
    enabled: active,
  });
  const updates = useQuery({
    queryKey: ["updates", selected],
    queryFn: () => request<Update[]>(token, `/projects/${selected}/updates`),
    enabled: active,
  });
  const initiatives = useQuery({
    queryKey: ["initiatives"],
    queryFn: () => request<Initiative[]>(token, `/initiatives`),
    enabled: active,
  });
  const capacity = useQuery({
    queryKey: ["capacity", selected],
    queryFn: () => request<Capacity[]>(token, `/capacity?project_id=${selected}`),
    enabled: active,
  });
  const baselines = useQuery({
    queryKey: ["baselines", selected],
    queryFn: () => request<Baseline[]>(token, `/projects/${selected}/baselines`),
    enabled: active,
  });
  const variance = useQuery({
    queryKey: ["variance", baseChoice],
    queryFn: () => request<Variance[]>(token, `/baselines/${baseChoice}/variance`),
    enabled: active && !!baseChoice,
  });
  const epics = (timeline.data ?? []).filter((t) => t.kind === "epic");
  if (!active) return null;

  const run = async (job: () => Promise<unknown>, message?: string) => {
    try {
      await job();
      await Promise.all(
        ["timeline", "milestones", "critical", "updates", "initiatives", "capacity", "baselines"].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
      if (message) toast(message);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const dated = (timeline.data ?? [])
    .flatMap((t) => [t.start, t.end])
    .filter((d): d is string => !!d)
    .map((d) => Date.parse(d));
  const lo = dated.length ? Math.min(...dated) : Date.now();
  const hi = dated.length ? Math.max(...dated, lo + 86_400_000) : lo + 86_400_000 * 30;
  const span = Math.max(hi - lo, 86_400_000);
  const at = (d: string) => `${Math.min(100, Math.max(0, ((Date.parse(d) - lo) / span) * 100))}%`;

  return (
    <section className="planning roadmap space-y-6" aria-labelledby="roadmap-title">
      <div className="planning-head">
        <PageHeader
          title="Roadmap & Governance"
          subtitle={`${project?.name ?? "Project"}. Project timeline, portfolio roll-up, and RAID register.`}
          actions={
            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-surface-2 border border-border rounded-xl">
              <button
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[30px] ${
                  subView === "roadmap"
                    ? "bg-accent text-white shadow-xs"
                    : "text-text-subtle hover:text-text-main"
                }`}
                onClick={() => setSubView("roadmap")}
              >
                Project Roadmap
              </button>
              <button
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[30px] ${
                  subView === "portfolio"
                    ? "bg-accent text-white shadow-xs"
                    : "text-text-subtle hover:text-text-main"
                }`}
                onClick={() => setSubView("portfolio")}
              >
                Portfolio Roll-up
              </button>
              <button
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all min-h-[30px] ${
                  subView === "raid"
                    ? "bg-accent text-white shadow-xs"
                    : "text-text-subtle hover:text-text-main"
                }`}
                onClick={() => setSubView("raid")}
              >
                RAID Register
              </button>
            </div>
          }
        />
        <h2 id="roadmap-title" className="sr-only">
          Roadmap & Governance
        </h2>
      </div>

      {subView === "portfolio" && <PortfolioOverviewView />}
      {subView === "raid" && <RaidRegisterView projectId={selected} />}

      {subView === "roadmap" && (
        <div className="space-y-6">
          {/* Gantt Timeline Card */}
          <Card className="panel overflow-hidden" aria-labelledby="timeline-title">
            <CardHeader className="border-b border-border pb-3">
              <CardTitle
                id="timeline-title"
                className="text-sm font-bold uppercase tracking-wider text-text-subtle"
              >
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-3">
              {(timeline.data ?? []).filter((t) => t.start || t.end).length === 0 && (
                <p className="text-xs text-text-subtle">
                  Add due dates to epics, target dates to releases, and sprint dates to see them here.
                </p>
              )}
              <ul className="timeline space-y-2.5 overflow-x-auto" aria-label="Timeline items">
                {(timeline.data ?? []).map((t) => (
                  <li
                    key={`${t.kind}-${t.id}`}
                    className="timeline-row flex items-center gap-3 p-2 rounded-lg hover:bg-surface-2 transition-colors text-xs"
                  >
                    <span className="timeline-name w-48 sm:w-64 shrink-0 truncate font-medium text-text-main">
                      <span className="uppercase text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-3 text-text-muted border border-border mr-1.5 capitalize whitespace-nowrap">
                        {t.kind}
                      </span>{" "}
                      {t.name}
                      {t.progress != null && (
                        <span className="text-text-subtle text-[11px]"> · {t.progress}%</span>
                      )}
                    </span>
                    <span
                      className="timeline-track flex-1 h-3 bg-bg border border-border rounded-full relative overflow-hidden"
                      aria-hidden
                    >
                      {t.kind === "milestone" && t.end ? (
                        <span
                          className="milestone-mark absolute top-0 bottom-0 w-2.5 bg-amber-500 rounded-full -ml-1"
                          style={{ left: at(t.end) }}
                        />
                      ) : t.start && t.end ? (
                        <span
                          className="timeline-bar absolute top-0 bottom-0 bg-accent/40 rounded-full overflow-hidden"
                          style={{ left: at(t.start), width: `calc(${at(t.end)} - ${at(t.start)})` }}
                        >
                          {t.progress != null && (
                            <span
                              className="timeline-progress h-full bg-accent block"
                              style={{ width: `${t.progress}%` }}
                            />
                          )}
                        </span>
                      ) : t.end ? (
                        <span
                          className="milestone-mark absolute top-0 bottom-0 w-2.5 bg-accent rounded-full -ml-1"
                          style={{ left: at(t.end) }}
                        />
                      ) : null}
                    </span>
                    <span className="shrink-0 text-text-subtle font-mono text-[11px] w-24 text-right">
                      {t.end ?? t.start ?? "no date"}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Grid of Roadmap Governance Sub-Panels */}
          <div className="roadmap-grid grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Milestones Card */}
            <Card className="panel" aria-labelledby="ms-title">
              <CardHeader className="pb-2">
                <CardTitle
                  id="ms-title"
                  className="text-sm font-bold uppercase tracking-wider text-text-subtle"
                >
                  Milestones
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <form
                  className="flex flex-wrap gap-2 items-center my-1.5 [&_input]:min-h-8 [&_select]:min-h-8"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!msName.trim() || !msDate || !selected) return;
                    run(async () => {
                      await send(`/projects/${selected}/milestones`, token, "POST", {
                        name: msName.trim(),
                        target_on: msDate,
                      });
                      setMsName("");
                      setMsDate("");
                    }, "Milestone added");
                  }}
                >
                  <input
                    aria-label="Milestone name"
                    placeholder="Milestone"
                    value={msName}
                    maxLength={120}
                    onChange={(e) => setMsName(e.target.value)}
                    className="flex-1 min-w-[120px] px-2.5 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <input
                    aria-label="Milestone date"
                    type="date"
                    value={msDate}
                    onChange={(e) => setMsDate(e.target.value)}
                    className="px-2.5 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-strong transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px] border border-border-strong hover:text-text-main"
                    disabled={!msName.trim() || !msDate}
                  >
                    Add
                  </button>
                </form>
                <ul className="divide-y divide-border/60 list-none my-1 p-0 flex flex-col gap-1">
                  {(milestones.data ?? []).map((m) => (
                    <li key={m.id} className="flex items-center justify-between py-2 text-xs">
                      <div>
                        <b className="text-text-main font-semibold">{m.name}</b>{" "}
                        <span className="text-text-subtle font-mono">· {m.target_on}</span>{" "}
                        {m.reached_on ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 rounded capitalize whitespace-nowrap">
                            Reached {m.reached_on}
                          </span>
                        ) : null}
                      </div>
                      <button
                        className="px-2 py-1 bg-surface-2 hover:bg-surface-3 border border-border rounded text-[11px] font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] text-text-muted hover:text-text-main"
                        onClick={() =>
                          run(() => send(`/milestones/${m.id}`, token, "PATCH", { reached: !m.reached_on }))
                        }
                      >
                        {m.reached_on ? "Reopen" : "Mark reached"}
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Critical Path Card */}
            <Card className="panel" aria-labelledby="crit-title">
              <CardHeader className="pb-2">
                <CardTitle
                  id="crit-title"
                  className="text-sm font-bold uppercase tracking-wider text-text-subtle"
                >
                  Critical path
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {critical.data?.has_cycle && (
                  <p className="text-xs text-danger bg-danger/10 p-2.5 rounded-lg border border-danger/20 py-[11px] px-[13px] my-3">
                    Dependencies form a loop. Break one link to see the path.
                  </p>
                )}
                {critical.data && !critical.data.has_cycle && critical.data.path.length === 0 && (
                  <p className="text-xs text-text-subtle">No blocking links between open issues yet.</p>
                )}
                {critical.data && critical.data.path.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-text-subtle">
                      {critical.data.path.length} steps · {formatMinutes(critical.data.total_minutes)} of
                      remaining work
                    </p>
                    <ol
                      className="divide-y divide-border/60 list-none my-1 p-0 flex flex-col gap-1"
                      aria-label="Critical path"
                    >
                      {critical.data.path.map((p) => (
                        <li key={p.issue_id} className="py-2 text-xs flex items-center justify-between">
                          <div>
                            <button
                              className="issue-number-button font-mono font-bold text-accent hover:underline mr-1.5"
                              onClick={() => setSelectedIssue(p.issue_id)}
                            >
                              {project?.key}-{p.number}
                            </button>
                            <span className="text-text-main font-medium">{p.title}</span>
                          </div>
                          <span className="text-text-subtle font-mono text-[11px]">
                            {formatMinutes(p.minutes)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Project Updates Card */}
            <Card className="panel" aria-labelledby="upd-title">
              <CardHeader className="pb-2">
                <CardTitle
                  id="upd-title"
                  className="text-sm font-bold uppercase tracking-wider text-text-subtle"
                >
                  Project updates
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <form
                  className="flex flex-wrap gap-2 items-center my-1.5 [&_input]:min-h-8 [&_select]:min-h-8"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!body.trim() || !selected) return;
                    run(async () => {
                      await send(`/projects/${selected}/updates`, token, "POST", {
                        health,
                        body: body.trim(),
                      });
                      setBody("");
                    }, "Update posted");
                  }}
                >
                  <select
                    aria-label="Health"
                    value={health}
                    onChange={(e) => setHealth(e.target.value)}
                    className="px-2.5 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {Object.entries(HEALTH).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Update"
                    placeholder="What changed?"
                    value={body}
                    maxLength={5000}
                    onChange={(e) => setBody(e.target.value)}
                    className="flex-1 min-w-[140px] px-2.5 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-strong transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px] border border-border-strong hover:text-text-main"
                    disabled={!body.trim()}
                  >
                    Post
                  </button>
                </form>
                <ul className="divide-y divide-border/60 list-none my-1 p-0 flex flex-col gap-1">
                  {(updates.data ?? []).slice(0, 10).map((u) => (
                    <li key={u.id} className="py-2 text-xs space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded capitalize whitespace-nowrap ${
                            u.health === "on_track"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {HEALTH[u.health] ?? u.health}
                        </span>
                        <span className="text-text-main font-medium">{u.body}</span>
                      </div>
                      <span className="block text-[11px] text-text-subtle">
                        — {u.author_name}, {formatDate(u.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Initiatives Card */}
            <Card className="panel" aria-labelledby="init-title">
              <CardHeader className="pb-2">
                <CardTitle
                  id="init-title"
                  className="text-sm font-bold uppercase tracking-wider text-text-subtle"
                >
                  Initiatives
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <form
                  className="flex flex-wrap gap-2 items-center my-1.5 [&_input]:min-h-8 [&_select]:min-h-8"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!initName.trim()) return;
                    run(async () => {
                      await send(`/initiatives`, token, "POST", {
                        name: initName.trim(),
                        target_on: initDate || null,
                      });
                      setInitName("");
                      setInitDate("");
                    }, "Initiative created");
                  }}
                >
                  <input
                    aria-label="Initiative name"
                    placeholder="Initiative"
                    value={initName}
                    maxLength={120}
                    onChange={(e) => setInitName(e.target.value)}
                    className="flex-1 min-w-[120px] px-2.5 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <input
                    aria-label="Initiative target"
                    type="date"
                    value={initDate}
                    onChange={(e) => setInitDate(e.target.value)}
                    className="px-2.5 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-strong transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px] border border-border-strong hover:text-text-main"
                    disabled={!initName.trim()}
                  >
                    Add
                  </button>
                </form>
                <ul className="divide-y divide-border/60 list-none my-1 p-0 flex flex-col gap-1">
                  {(initiatives.data ?? []).map((n) => {
                    const pct = n.epics ? Math.round((n.epics_done / n.epics) * 100) : 0;
                    return (
                      <li key={n.id} className="py-2 text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <b className="text-text-main font-semibold">{n.name}</b>
                          <span className="text-text-subtle">
                            {n.epics_done}/{n.epics} epics done
                          </span>
                        </div>
                        <div
                          className="progress-track w-full h-1.5 bg-bg rounded-full overflow-hidden border border-border/60"
                          aria-hidden
                        >
                          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {epics.length > 0 && (initiatives.data ?? []).length > 0 && (
                  <form
                    className="flex flex-wrap gap-2 pt-2 border-t border-border items-center my-1.5 [&_input]:min-h-8 [&_select]:min-h-8"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!initPick || !epicPick) return;
                      run(
                        () => send(`/initiatives/${initPick}/epics`, token, "PUT", { issue_ids: [epicPick] }),
                        "Epic linked",
                      );
                      setEpicPick("");
                    }}
                  >
                    <select
                      aria-label="Initiative to link"
                      value={initPick}
                      onChange={(e) => setInitPick(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-main"
                    >
                      <option value="">Initiative…</option>
                      {(initiatives.data ?? []).map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Epic to link"
                      value={epicPick}
                      onChange={(e) => setEpicPick(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-main"
                    >
                      <option value="">Epic…</option>
                      {epics.map((ep) => (
                        <option key={ep.id} value={ep.id}>
                          {ep.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 border border-border rounded-lg text-xs font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] text-text-muted hover:text-text-main"
                      disabled={!initPick || !epicPick}
                    >
                      Link epic
                    </button>
                  </form>
                )}
              </CardContent>
            </Card>

            {/* Capacity Card */}
            <Card className="panel overflow-hidden" aria-labelledby="cap-title">
              <CardHeader className="pb-2">
                <CardTitle
                  id="cap-title"
                  className="text-sm font-bold uppercase tracking-wider text-text-subtle"
                >
                  Capacity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="simple-table w-full text-left text-xs" aria-label="Capacity by member">
                    <thead className="bg-surface-2 border-b border-border text-text-subtle font-semibold uppercase text-[10px]">
                      <tr>
                        <th scope="col" className="p-3">
                          Member
                        </th>
                        <th scope="col" className="p-3">
                          Hours a week
                        </th>
                        <th scope="col" className="p-3">
                          Open work
                        </th>
                        <th scope="col" className="p-3">
                          Load
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {(capacity.data ?? []).map((c) => (
                        <tr key={c.user_id} className="hover:bg-surface-2 transition-colors">
                          <td className="p-3 font-medium text-text-main">{c.name}</td>
                          <td className="p-3">
                            <input
                              aria-label={`Hours a week for ${c.name}`}
                              type="number"
                              min={0}
                              max={168}
                              step={0.5}
                              defaultValue={c.hours_per_week ?? ""}
                              className="w-20 px-2 py-1 bg-bg border border-border rounded text-xs text-text-main"
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (e.target.value === "" || v === c.hours_per_week) return;
                                run(
                                  () =>
                                    send(`/members/${c.user_id}/capacity`, token, "PUT", {
                                      hours_per_week: v,
                                    }),
                                  "Capacity saved",
                                );
                              }}
                            />
                          </td>
                          <td className="p-3 text-text-subtle">
                            {c.open_issues} issues · {c.remaining_hours.toFixed(1)} h left
                          </td>
                          <td className="p-3 font-mono font-semibold text-accent">
                            {c.utilisation_pct == null ? "–" : `${Math.round(c.utilisation_pct)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Baselines Card */}
            <Card className="panel" aria-labelledby="base-title">
              <CardHeader className="pb-2">
                <CardTitle
                  id="base-title"
                  className="text-sm font-bold uppercase tracking-wider text-text-subtle"
                >
                  Baselines
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <form
                  className="flex flex-wrap gap-2 items-center my-1.5 [&_input]:min-h-8 [&_select]:min-h-8"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!baseName.trim() || !selected) return;
                    run(async () => {
                      const created = await send<Baseline>(`/projects/${selected}/baselines`, token, "POST", {
                        name: baseName.trim(),
                      });
                      setBaseName("");
                      setBaseChoice(created.id);
                    }, "Baseline saved");
                  }}
                >
                  <input
                    aria-label="Baseline name"
                    placeholder="Baseline name"
                    value={baseName}
                    maxLength={120}
                    onChange={(e) => setBaseName(e.target.value)}
                    className="flex-1 min-w-[140px] px-2.5 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-strong transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px] border border-border-strong hover:text-text-main"
                    disabled={!baseName.trim()}
                  >
                    Save baseline
                  </button>
                </form>
                <select
                  aria-label="Baseline to compare"
                  value={baseChoice}
                  onChange={(e) => setBaseChoice(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Compare with…</option>
                  {(baselines.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.items} issues)
                    </option>
                  ))}
                </select>
                {variance.data && (
                  <p className="text-xs text-text-subtle">
                    {variance.data.filter((v) => (v.variance_days ?? 0) > 0 && !v.done).length} open issues
                    later than baseline · {variance.data.filter((v) => v.done).length} done
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </section>
  );
}
