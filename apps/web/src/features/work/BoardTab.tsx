import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Settings2, SlidersHorizontal } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { Skeleton } from "../shared/Avatar";
import { api } from "../../lib/api";
import type { BoardLane, BoardView } from "../../lib/types";
import { KindIcon, PriorityIcon } from "./meta";
import { WorkflowEditor } from "./WorkflowEditor";
import { FieldEditor } from "./FieldEditor";
import { TransitionEditor } from "./TransitionEditor";
import { SecurityLevels } from "./SecurityLevels";
import { PermissionScheme } from "./PermissionScheme";
import { CustomRoles } from "./CustomRoles";
import { ChatChannels } from "./ChatChannels";
import { Card, CardContent } from "../shared/UiComponents";

type Group = "none" | "assignee" | "epic";

type BoardPrefs = { group: Group; mine: boolean; unassigned: boolean; high: boolean };

const DEFAULT_PREFS: BoardPrefs = { group: "none", mine: false, unassigned: false, high: false };

function readPrefs(projectId: string): BoardPrefs {
  try {
    const raw = window.localStorage.getItem(`meridian.board.${projectId}`);
    if (!raw) return DEFAULT_PREFS;
    const v = JSON.parse(raw) as Partial<BoardPrefs>;
    const group: Group = v.group === "assignee" || v.group === "epic" ? v.group : "none";
    return { group, mine: v.mine === true, unassigned: v.unassigned === true, high: v.high === true };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(projectId: string, prefs: BoardPrefs) {
  try {
    window.localStorage.setItem(`meridian.board.${projectId}`, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function BoardTab() {
  const {
    issues,
    project,
    tab,
    setModal,
    setSelectedIssue,
    move,
    loading,
    statuses,
    statusLabel,
    session,
    selected,
    me,
  } = useWorkspace();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [prefs, setPrefs] = useState<BoardPrefs>(DEFAULT_PREFS);
  const [activeMobileCol, setActiveMobileCol] = useState<string>("all");

  useEffect(() => {
    setPrefs(readPrefs(selected));
  }, [selected]);

  const changePrefs = (next: BoardPrefs) => {
    setPrefs(next);
    writePrefs(selected, next);
  };

  const mine = prefs.mine && me?.user_id ? me.user_id : undefined;
  const boardQ = useQuery({
    queryKey: ["board", selected, prefs.group, mine ?? "", prefs.unassigned, prefs.high],
    queryFn: () => {
      const params = new URLSearchParams({ group_by: prefs.group });
      if (mine) params.set("assignee_id", mine);
      if (prefs.unassigned) params.set("unassigned", "true");
      if (prefs.high) params.set("priority", "high");
      return api<BoardView>(`/projects/${selected}/board?${params.toString()}`, session.token);
    },
    enabled: !!selected && tab === "board",
  });

  if (tab !== "board") return null;

  const keys = statuses.map((s) => s.key);
  const step = (status: string, dir: -1 | 1) => keys[keys.indexOf(status) + dir];
  const lanes: BoardLane[] = boardQ.data?.lanes ?? [];
  const lanesShown: BoardLane[] =
    prefs.group === "none"
      ? [{ key: "all", label: "All issues", issues: lanes.flatMap((l) => l.issues) }]
      : lanes;

  const totals = new Map<string, number>();
  for (const lane of lanesShown) {
    for (const i of lane.issues) totals.set(i.status, (totals.get(i.status) ?? 0) + 1);
  }
  const fullIssue = (id: string) => issues.find((x) => x.id === id);
  const busyLoading = loading || (boardQ.isLoading && !boardQ.data);

  const dotColors = ["bg-slate-400", "bg-sky-500", "bg-amber-500", "bg-emerald-500"];

  const renderColumn = (laneKey: string, status: (typeof statuses)[number], index: number) => {
    const dropKey = `${laneKey}|${status.key}`;
    const list =
      lanesShown.find((l) => l.key === laneKey)?.issues.filter((i) => i.status === status.key) ?? [];

    const isVisibleOnMobile = activeMobileCol === "all" || activeMobileCol === status.key;

    return (
      <section
        key={dropKey}
        aria-label={status.name}
        className={`w-[85vw] sm:w-auto shrink-0 sm:shrink snap-start rounded-xl p-3.5 flex flex-col gap-3 min-h-[480px] transition-colors border ${
          isVisibleOnMobile ? "flex" : "hidden sm:flex"
        } ${
          over === dropKey
            ? "bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700"
            : "bg-slate-100/70 dark:bg-slate-850/60 border-slate-200/60 dark:border-slate-800/60"
        }`}
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (over !== dropKey) setOver(dropKey);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const issue = fullIssue(dragId ?? e.dataTransfer.getData("text/plain"));
          setOver(null);
          setDragId(null);
          if (issue) move(issue, status.key);
        }}
      >
        {/* Column Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 dark:border-slate-800/80">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${dotColors[index % dotColors.length]}`} />
            <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 m-0">
              {status.name}
            </h4>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/80 dark:border-slate-700 shadow-2xs">
            {totals.get(status.key) ?? 0}
            {status.wip_limit ? ` / ${status.wip_limit}` : ""}
          </span>
        </div>

        {/* Loading Skeletons */}
        {busyLoading &&
          [0, 1].map((n) => (
            <div
              key={n}
              className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200 dark:border-slate-800 space-y-2"
            >
              <Skeleton w="40%" h={10} />
              <Skeleton h={14} />
            </div>
          ))}

        {/* Issue Cards */}
        <div className="space-y-2.5 flex-1 overflow-y-auto">
          {list.map((i) => (
            <article
              key={i.id}
              draggable
              tabIndex={0}
              aria-label={`${project?.key}-${i.number} ${i.title}, ${statusLabel(i.status)}`}
              className={`bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3.5 shadow-2xs hover:shadow-md transition-all cursor-pointer ${
                dragId === i.id ? "opacity-40 rotate-1" : ""
              }`}
              onDragStart={(e) => {
                setDragId(i.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", i.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOver(null);
              }}
              onClick={() => setSelectedIssue(i.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target === e.currentTarget) setSelectedIssue(i.id);
                if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
                  e.preventDefault();
                  const to = step(i.status, e.key === "ArrowRight" ? 1 : -1);
                  const full = fullIssue(i.id);
                  if (to && full) move(full, to);
                }
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <KindIcon kind={i.kind} />
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                    {project?.key}-{i.number}
                  </span>
                </div>
                <PriorityIcon priority={i.priority} label={false} />
              </div>

              <h5 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white line-clamp-2 m-0 mb-3 leading-snug">
                {i.title}
              </h5>

              <div
                className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                <PriorityIcon priority={i.priority} />
                <select
                  aria-label="Move issue"
                  value={i.status}
                  onChange={(e) => {
                    const full = fullIssue(i.id);
                    if (full) move(full, e.target.value);
                  }}
                  className="px-2 py-1 rounded-md text-[11px] font-semibold border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer focus:outline-hidden"
                >
                  {statuses.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
            </article>
          ))}

          {!busyLoading && !list.length && prefs.group === "none" && (
            <div className="py-12 text-center text-xs text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              Drop issues here
            </div>
          )}
        </div>
      </section>
    );
  };

  const chip = (label: string, on: boolean, toggle: () => void) => (
    <button
      type="button"
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer shrink-0 ${
        on
          ? "bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-bold"
          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
      }`}
      aria-pressed={on}
      onClick={toggle}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Board Controls Toolbar */}
      <Card>
        <CardContent className="p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold flex items-center justify-center uppercase">
                {project?.key.slice(0, 2)}
              </span>
              <span className="font-bold text-sm text-slate-900 dark:text-white">{project?.name}</span>
            </div>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />

            {/* Swimlanes dropdown */}
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="hidden sm:inline font-medium">Swimlanes:</span>
              <select
                aria-label="Swimlanes"
                value={prefs.group}
                onChange={(e) => changePrefs({ ...prefs, group: e.target.value as Group })}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                <option value="none">None</option>
                <option value="assignee">By Assignee</option>
                <option value="epic">By Epic</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing((v) => !v)}
              disabled={!selected}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            >
              <Settings2 size={14} /> Workflow
            </button>
            <button
              onClick={() => setModal("issue")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer"
            >
              <Plus size={15} /> Add issue
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Quick Filter Bar */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-slate-400 font-semibold flex items-center gap-1 text-[11px] uppercase tracking-wider mr-1">
            <SlidersHorizontal size={13} /> Filters:
          </span>
          {chip("Only my issues", prefs.mine, () => changePrefs({ ...prefs, mine: !prefs.mine }))}
          {chip("Unassigned", prefs.unassigned, () =>
            changePrefs({ ...prefs, unassigned: !prefs.unassigned }),
          )}
          {chip("High priority", prefs.high, () => changePrefs({ ...prefs, high: !prefs.high }))}
          {(prefs.mine || prefs.unassigned || prefs.high) && (
            <button
              type="button"
              className="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold ml-2 cursor-pointer"
              onClick={() => changePrefs({ ...prefs, mine: false, unassigned: false, high: false })}
            >
              Clear filters
            </button>
          )}
        </div>

        {boardQ.data?.truncated && (
          <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0">
            Showing first 2,000 issues.
          </span>
        )}
      </div>

      {/* Mobile Column Tab Switcher */}
      <div className="flex sm:hidden items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none">
        <button
          onClick={() => setActiveMobileCol("all")}
          className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
            activeMobileCol === "all"
              ? "bg-indigo-600 text-white"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
          }`}
        >
          All ({issues.length})
        </button>
        {statuses.map((s) => {
          const count = totals.get(s.key) ?? 0;
          const isAct = activeMobileCol === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setActiveMobileCol(s.key)}
              className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                isAct
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}
            >
              {s.name} ({count})
            </button>
          );
        })}
      </div>

      {boardQ.isError && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 text-xs">
          Could not load the board.
        </div>
      )}

      {/* Workflow Editors (when expanded) */}
      {editing && (
        <div className="space-y-4">
          <WorkflowEditor token={session.token} projectId={selected} statuses={statuses} />
          <FieldEditor token={session.token} projectId={selected} />
          <TransitionEditor token={session.token} projectId={selected} statuses={statuses} />
          <SecurityLevels token={session.token} projectId={selected} />
          <PermissionScheme token={session.token} projectId={selected} />
          <CustomRoles token={session.token} projectId={selected} />
          <ChatChannels token={session.token} projectId={selected} />
        </div>
      )}

      {/* Kanban Swimlanes / Columns */}
      <div className="space-y-6">
        {lanesShown.map((lane) => (
          <div key={lane.key} className="space-y-3">
            {prefs.group !== "none" && (
              <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <span>{lane.label}</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600">
                  {lane.issues.length}
                </span>
              </h3>
            )}
            <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
              {statuses.map((status, index) => renderColumn(lane.key, status, index))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
