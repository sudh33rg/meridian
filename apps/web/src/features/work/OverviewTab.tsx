import { formatDate } from "../../lib/datetime";
import React from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Circle,
  Clock3,
  FileText,
  ListTodo,
  Plus,
  Sparkles,
} from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { Skeleton } from "../shared/Avatar";
import { KindIcon, StatusPill } from "./meta";
import { statusClass, type ProjectStatus } from "../../lib/statuses";
import { Card, CardHeader, CardTitle, CardContent, StatCard } from "../shared/UiComponents";

function Ring({ pct }: { pct: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width="54"
      height="54"
      viewBox="0 0 54 54"
      role="img"
      aria-label={`${pct}% complete`}
      className="shrink-0"
    >
      <circle
        cx="27"
        cy="27"
        r={r}
        className="stroke-slate-100 dark:stroke-slate-800 fill-none"
        strokeWidth="5"
      />
      <circle
        cx="27"
        cy="27"
        r={r}
        className="stroke-indigo-600 dark:stroke-indigo-400 fill-none transition-all duration-500 ease-out"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (c * pct) / 100}
        transform="rotate(-90 27 27)"
      />
      <text
        x="27"
        y="31"
        textAnchor="middle"
        className="fill-slate-900 dark:fill-white font-bold text-[11px] font-sans"
      >
        {pct}%
      </text>
    </svg>
  );
}

export function OverviewTab() {
  const { issues, pages, project, tab, setTab, setActivePage, setModal, loading, statuses } = useWorkspace();
  if (tab !== "overview") return null;

  const categoryOf = (key: string) => statuses.find((s) => s.key === key)?.category;
  const done = issues.filter((i) => categoryOf(i.status) === "done").length;
  const inProg = issues.filter((i) => categoryOf(i.status) === "in_progress").length;
  const pct = issues.length ? Math.round((done / issues.length) * 100) : 0;

  const steps = [
    { label: "Create a project", done: !!project, run: () => setModal("project") },
    { label: "Add your first issue", done: issues.length > 0, run: () => setModal("issue") },
    {
      label: "Move an issue forward",
      done: issues.some((i) => i.status !== "todo"),
      run: () => setTab("board"),
    },
    { label: "Write a knowledge page", done: pages.length > 0, run: () => setModal("page") },
    { label: "Invite a teammate", done: false, run: () => setTab("people") },
  ];
  const finished = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-6">
      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Issues"
          value={loading ? "…" : issues.length}
          subvalue={`Across ${project?.name || "all projects"}`}
          icon={ListTodo}
          color="indigo"
        />
        <StatCard
          label="In Progress"
          value={loading ? "…" : inProg}
          subvalue="Currently moving"
          icon={Clock3}
          color="sky"
        />
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-4 sm:p-5 flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                Completed
              </span>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                {loading ? "…" : done}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-0 truncate">Work delivered</p>
            </div>
            <Ring pct={pct} />
          </CardContent>
        </Card>
        <StatCard
          label="Knowledge Pages"
          value={loading ? "…" : pages.length}
          subvalue="Shared with your team"
          icon={BookOpen}
          color="emerald"
        />
      </div>

      {/* Status Breakdown Bar */}
      {issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Status Breakdown</CardTitle>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {issues.length} total work items
            </span>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 space-y-4">
            {/* Stack bar */}
            <div
              className="w-full h-3 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800"
              role="img"
              aria-label="Issues by status"
            >
              {statuses.map((s: ProjectStatus) => {
                const n = issues.filter((i) => i.status === s.key).length;
                if (!n) return null;
                const cls = statusClass(s);
                const bgClass =
                  cls === "done"
                    ? "bg-emerald-500"
                    : cls === "in_progress"
                      ? "bg-sky-500"
                      : cls === "in_review"
                        ? "bg-amber-500"
                        : "bg-slate-300 dark:bg-slate-600";
                return (
                  <div
                    key={s.key}
                    className={`${bgClass} transition-all duration-300 hover:opacity-90`}
                    style={{ flex: n }}
                    title={`${s.name}: ${n}`}
                  />
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              {statuses.map((s: ProjectStatus) => {
                const count = issues.filter((i) => i.status === s.key).length;
                const cls = statusClass(s);
                const dotClass =
                  cls === "done"
                    ? "bg-emerald-500"
                    : cls === "in_progress"
                      ? "bg-sky-500"
                      : cls === "in_review"
                        ? "bg-amber-500"
                        : "bg-slate-400";
                return (
                  <div key={s.key} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${dotClass}`} />
                    <span className="text-slate-600 dark:text-slate-400 font-medium">{s.name}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Getting Started Checklist */}
      {finished < steps.length && (
        <Card className="border-indigo-100 dark:border-indigo-900/50 bg-gradient-to-r from-indigo-50/40 via-white to-white dark:from-indigo-950/20 dark:via-slate-900 dark:to-slate-900">
          <CardHeader>
            <CardTitle className="text-indigo-900 dark:text-indigo-300">
              <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400" />
              Getting Started Checklist
            </CardTitle>
            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
              {finished} of {steps.length} completed
            </span>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 space-y-4">
            <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                style={{ width: `${(finished / steps.length) * 100}%` }}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {steps.map((s) => (
                <button
                  key={s.label}
                  onClick={s.run}
                  disabled={s.done}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border text-xs sm:text-sm font-semibold transition-colors text-left ${
                    s.done
                      ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-300 opacity-80 cursor-default"
                      : "bg-white dark:bg-slate-800/80 border-slate-200/80 dark:border-slate-700/80 text-slate-800 dark:text-slate-200 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50/30 cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    {s.done ? (
                      <Check size={16} className="text-emerald-600 shrink-0" />
                    ) : (
                      <Circle size={16} className="text-slate-400 shrink-0" />
                    )}
                    <span className="truncate">{s.label}</span>
                  </div>
                  {!s.done && <ArrowUpRight size={14} className="text-slate-400 shrink-0" />}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Two-Column Grid: Recent Work & Team Knowledge */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Work */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Work</CardTitle>
            <button
              onClick={() => setTab("issues")}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
            >
              View all <ArrowUpRight size={14} />
            </button>
          </CardHeader>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {loading &&
              [0, 1, 2].map((n) => (
                <div key={n} className="p-4 flex items-center gap-3">
                  <Skeleton w={28} h={28} r={7} />
                  <div className="flex-1">
                    <Skeleton w="65%" h={14} />
                  </div>
                </div>
              ))}
            {!loading &&
              issues.slice(0, 6).map((i) => (
                <div
                  key={i.id}
                  className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <KindIcon kind={i.kind} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {i.title}
                      </div>
                      <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                        {project?.key}-{i.number} · <span className="capitalize">{i.kind}</span>
                      </div>
                    </div>
                  </div>
                  <StatusPill status={i.status} />
                </div>
              ))}
            {!loading && !issues.length && (
              <div className="py-12 text-center px-4">
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-3">No work yet.</p>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer"
                  onClick={() => setModal("issue")}
                >
                  <Plus size={14} /> Create your first issue
                </button>
              </div>
            )}
          </div>
        </Card>

        {/* Team Knowledge */}
        <Card>
          <CardHeader>
            <CardTitle>Team Knowledge</CardTitle>
            <button
              onClick={() => setTab("knowledge")}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
            >
              Explore <ArrowUpRight size={14} />
            </button>
          </CardHeader>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {pages.slice(0, 6).map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setTab("knowledge");
                  setActivePage(p);
                }}
                className="w-full p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <FileText size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {p.title}
                    </div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                      Version {p.version} · Updated {formatDate(p.updated_at)}
                    </div>
                  </div>
                </div>
                <ArrowUpRight size={15} className="text-slate-400 shrink-0" />
              </button>
            ))}
            {!loading && !pages.length && (
              <div className="py-12 text-center px-4">
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-3">
                  Capture project decisions, architecture notes, and documentation.
                </p>
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                  onClick={() => setModal("page")}
                >
                  <Plus size={14} /> New page
                </button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
