import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Settings2 } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { Skeleton } from "../shared/Avatar";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import type { BoardLane, BoardView } from "../../lib/types";
import { KindIcon, PriorityIcon } from "./meta";
import { WorkflowEditor } from "./WorkflowEditor";
import { FieldEditor } from "./FieldEditor";
import { TransitionEditor } from "./TransitionEditor";
import { SecurityLevels } from "./SecurityLevels";
import { PermissionScheme } from "./PermissionScheme";

type Group = "none" | "assignee" | "epic";

/** Per-viewer board preferences. Kept in this browser only; they are not shared with other members. */
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
    // Storage can be blocked (private windows, cleared site data). The board still works without it.
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
    prefs.group === "none" ? [{ key: "all", label: "All issues", issues: lanes.flatMap((l) => l.issues) }] : lanes;
  const totals = new Map<string, number>();
  for (const lane of lanesShown) for (const i of lane.issues) totals.set(i.status, (totals.get(i.status) ?? 0) + 1);
  const fullIssue = (id: string) => issues.find((x) => x.id === id);
  const busyLoading = loading || (boardQ.isLoading && !boardQ.data);

  const renderColumn = (laneKey: string, status: (typeof statuses)[number], index: number) => {
    const dropKey = `${laneKey}|${status.key}`;
    const list = lanesShown.find((l) => l.key === laneKey)?.issues.filter((i) => i.status === status.key) ?? [];
    return (
      <section
        className={"column" + (over === dropKey ? " drop" : "")}
        key={dropKey}
        aria-label={status.name}
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
        {laneKey === (lanesShown[0]?.key ?? "all") && (
          <div className="column-title">
            <span className={"column-dot dot-" + Math.min(index, 3)} />
            <b>{status.name}</b>
            <span className="count">
              {totals.get(status.key) ?? 0}
              {status.wip_limit ? ` / ${status.wip_limit}` : ""}
            </span>
          </div>
        )}
        {busyLoading &&
          [0, 1].map((n) => (
            <div className="issue-card" key={n}>
              <Skeleton w="40%" h={10} />
              <Skeleton h={12} />
            </div>
          ))}
        {list.map((i) => (
          <article
            className={"issue-card" + (dragId === i.id ? " dragging" : "")}
            key={i.id}
            draggable
            tabIndex={0}
            aria-label={`${project?.key}-${i.number} ${i.title}, ${statusLabel(i.status)}`}
            onDragStart={(e) => {
              setDragId(i.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", i.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOver(null);
            }}
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
            <div className="issue-top">
              <KindIcon kind={i.kind} />
              <button className="issue-number-button" onClick={() => setSelectedIssue(i.id)}>
                {project?.key}-{i.number}
              </button>
              <PriorityIcon priority={i.priority} label={false} />
            </div>
            <h4>{i.title}</h4>
            <div className="issue-foot">
              <PriorityIcon priority={i.priority} />
              <select
                aria-label="Move issue"
                value={i.status}
                onChange={(e) => {
                  const full = fullIssue(i.id);
                  if (full) move(full, e.target.value);
                }}
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
        {!busyLoading && !list.length && prefs.group === "none" && <div className="column-empty">Drop issues here</div>}
      </section>
    );
  };

  const chip = (label: string, on: boolean, toggle: () => void) => (
    <button
      type="button"
      className={"chip" + (on ? " on" : "")}
      aria-pressed={on}
      onClick={toggle}
    >
      {label}
    </button>
  );

  return (
    <div className="board">
      <div className="board-toolbar">
        <span className="board-title">
          <span className="project-icon sm">{project?.key.slice(0, 2)}</span> {project?.name}
        </span>
        <span className="muted small hide-sm">
          {t("board.hint")}
        </span>
        <label className="board-group">
          <span className="muted small">{t("board.swimlanes")}</span>
          <select
            aria-label="Swimlanes"
            value={prefs.group}
            onChange={(e) => changePrefs({ ...prefs, group: e.target.value as Group })}
          >
            <option value="none">{t("board.none")}</option>
            <option value="assignee">{t("board.byAssignee")}</option>
            <option value="epic">{t("board.byEpic")}</option>
          </select>
        </label>
        <button
          className="secondary"
          aria-expanded={editing}
          onClick={() => setEditing((v) => !v)}
          disabled={!selected}
        >
          <Settings2 size={15} /> {t("board.workflow")}
        </button>
        <button className="secondary" onClick={() => setModal("issue")}>
          <Plus size={15} /> {t("board.addIssue")}
        </button>
      </div>
      <div className="board-quick" role="group" aria-label={t("board.quickFilters")}>
        {chip(t("board.mine"), prefs.mine, () => changePrefs({ ...prefs, mine: !prefs.mine }))}
        {chip(t("board.unassigned"), prefs.unassigned, () => changePrefs({ ...prefs, unassigned: !prefs.unassigned }))}
        {chip(t("board.highPriority"), prefs.high, () => changePrefs({ ...prefs, high: !prefs.high }))}
        {(prefs.mine || prefs.unassigned || prefs.high) && (
          <button type="button" className="link" onClick={() => changePrefs({ ...prefs, mine: false, unassigned: false, high: false })}>
            {t("board.clearFilters")}
          </button>
        )}
        {boardQ.data?.truncated && (
          <span className="muted small">Showing the first 2,000 matching issues. Narrow the filters to see the rest.</span>
        )}
      </div>
      {boardQ.isError && <p className="error">Could not load the board.</p>}
      {editing && (
        <>
          <WorkflowEditor token={session.token} projectId={selected} statuses={statuses} />
          <FieldEditor token={session.token} projectId={selected} />
          <TransitionEditor token={session.token} projectId={selected} statuses={statuses} />
          <SecurityLevels token={session.token} projectId={selected} />
          <PermissionScheme token={session.token} projectId={selected} />
        </>
      )}
      <div className="swimlanes">
        {lanesShown.map((lane) => (
          <div className="swimlane" key={lane.key}>
            {prefs.group !== "none" && (
              <h3 className="lane-title">
                {lane.label} <span className="count">{lane.issues.length}</span>
              </h3>
            )}
            <div className="columns">
              {statuses.map((status, index) => renderColumn(lane.key, status, index))}
            </div>
          </div>
        ))}
        {!lanesShown.length && !busyLoading && (
          <div className="columns">
            {statuses.map((status, index) => renderColumn("all", status, index))}
          </div>
        )}
      </div>
    </div>
  );
}
