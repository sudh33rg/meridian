import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, ChevronDown, ChevronUp, Play, Square, X } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { Burndown } from "./Burndown";
import {
  type Burndown as BurndownData,
  type Sprint,
  type SprintDetail,
  type Team,
  SPRINT_STATE_LABEL,
  invalidatePlanning,
  isOpenSprint,
  shortDay,
  teamName,
} from "./agile-shared";

/** One sprint: totals, its issues, start and close, and the burndown. Also a drop target for backlog items. */
export function SprintCard({
  projectId,
  projectKey,
  sprint,
  sprints,
  teams,
  compact = false,
}: {
  projectId: string;
  projectKey: string;
  sprint: Sprint;
  /** Every sprint in the project, used to pick where unfinished work goes on close. */
  sprints: Sprint[];
  teams: Team[];
  compact?: boolean;
}) {
  const { session, setError } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [dropping, setDropping] = useState(false);
  const [closing, setClosing] = useState(false);
  const [carryOver, setCarryOver] = useState("backlog");
  const [showBurndown, setShowBurndown] = useState(false);
  const detail = useQuery({
    queryKey: ["sprint", sprint.id],
    queryFn: () => request<SprintDetail>(session.token, `/sprints/${sprint.id}`),
    enabled: open || dropping,
  });
  const burn = useQuery({
    queryKey: ["burndown", sprint.id],
    queryFn: () => request<BurndownData>(session.token, `/sprints/${sprint.id}/burndown`),
    enabled: showBurndown && sprint.state !== "planned",
  });
  const done = async (message: string) => {
    await invalidatePlanning(qc, projectId);
    toast(message);
  };
  const run = (job: () => Promise<unknown>) => {
    job().catch((e) => setError(errorMessage(e)));
  };
  const totals = detail.data?.totals;
  const issues = detail.data?.issues ?? [];
  const carryTargets = sprints.filter(
    (s) => s.id !== sprint.id && isOpenSprint(s) && s.team_id === sprint.team_id,
  );
  const teamLabel = teamName(teams, sprint.team_id);

  return (
    <section
      className={"sprint-card" + (dropping ? " drop" : "") + (sprint.state === "completed" ? " closed" : "")}
      aria-label={`${sprint.name}, ${SPRINT_STATE_LABEL[sprint.state] ?? sprint.state}`}
      onDragOver={(e) => {
        if (sprint.state === "completed") return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const id = e.dataTransfer.getData("text/plain");
        if (!id || sprint.state === "completed") return;
        run(async () => {
          const res = await send<MembershipResultLike>(`/sprints/${sprint.id}/issues`, session.token, "POST", {
            issue_ids: [id],
          });
          const refused = res.results.find((r) => !r.ok);
          if (refused?.error) setError(refused.error);
          else toast(`Added to ${sprint.name}`);
          await invalidatePlanning(qc, projectId);
        });
      }}
    >
      <header className="sprint-card-head">
        <button
          className="icon-ghost"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${sprint.name}`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="sprint-card-title">
          <h3>{sprint.name}</h3>
          <div className="sprint-meta small muted">
            <span className={"chip " + (sprint.state === "active" ? "success" : "")}>
              {SPRINT_STATE_LABEL[sprint.state] ?? sprint.state}
            </span>
            {teamLabel && <span className="chip">{teamLabel}</span>}
            {(sprint.starts_at || sprint.ends_at) && (
              <span>
                {shortDay(sprint.starts_at)}
                {sprint.ends_at ? ` – ${shortDay(sprint.ends_at)}` : ""}
              </span>
            )}
          </div>
        </div>
        {totals && (
          <span className="sprint-totals small" aria-label="Sprint totals">
            {totals.done_points}/{totals.scope_points} pts · {totals.done_count}/{totals.scope_count} issues
          </span>
        )}
      </header>
      {open && (
        <div className="sprint-card-body">
          {sprint.goal && <p className="sprint-goal">{sprint.goal}</p>}
          {sprint.state === "completed" && sprint.final_done_points != null && (
            <p className="small muted">
              Closed with {sprint.final_done_points} of {sprint.final_scope_points ?? 0} pts done
              {sprint.carried_over_count ? `, ${sprint.carried_over_count} issues carried over` : ""}.
            </p>
          )}
          {!compact && sprint.state !== "planned" && (
            <button className="secondary small-btn" onClick={() => setShowBurndown((v) => !v)} aria-expanded={showBurndown}>
              <BarChart3 size={14} /> {showBurndown ? "Hide burndown" : "Show burndown"}
            </button>
          )}
          {showBurndown && burn.data && <Burndown data={burn.data} />}
          {showBurndown && burn.isLoading && <p className="small muted">Loading burndown…</p>}
          <ul className="sprint-issues" aria-label={`Issues in ${sprint.name}`}>
            {issues.map((issue) => (
              <li key={issue.id} className="sprint-issue">
                <span className="mono small">
                  {projectKey}-{issue.number}
                </span>
                <span className="sprint-issue-title">{issue.title}</span>
                <span className="small muted">{issue.story_points != null ? `${issue.story_points} pt` : ""}</span>
                {sprint.state !== "completed" && (
                  <button
                    className="icon-ghost"
                    aria-label={`Remove ${projectKey}-${issue.number} from ${sprint.name}`}
                    onClick={() =>
                      run(async () => {
                        await send(`/sprints/${sprint.id}/issues/${issue.id}`, session.token, "DELETE");
                        await done("Moved back to the backlog");
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
            {open && !detail.isLoading && issues.length === 0 && (
              <li className="small muted sprint-empty">
                {sprint.state === "completed"
                  ? "No issues were in this sprint."
                  : "Drag issues here from the backlog, or use “Move to sprint”."}
              </li>
            )}
          </ul>
          {sprint.state === "planned" && (
            <button
              className="primary small-btn"
              onClick={() =>
                run(async () => {
                  await send(`/sprints/${sprint.id}`, session.token, "PATCH", { state: "active" });
                  await done(`${sprint.name} started`);
                })
              }
            >
              <Play size={14} /> Start sprint
            </button>
          )}
          {sprint.state === "active" && !closing && (
            <button className="secondary small-btn" onClick={() => setClosing(true)}>
              <Square size={14} /> Complete sprint
            </button>
          )}
          {sprint.state === "active" && closing && (
            <div className="sprint-close" role="group" aria-label={`Complete ${sprint.name}`}>
              <label className="small">
                Unfinished work goes to
                <select value={carryOver} onChange={(e) => setCarryOver(e.target.value)}>
                  <option value="backlog">Backlog</option>
                  {carryTargets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary small-btn"
                onClick={() =>
                  run(async () => {
                    await send(`/sprints/${sprint.id}`, session.token, "PATCH", {
                      state: "completed",
                      carry_over_to: carryOver,
                    });
                    setClosing(false);
                    await done(`${sprint.name} closed`);
                  })
                }
              >
                Confirm close
              </button>
              <button className="secondary small-btn" onClick={() => setClosing(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Subset of `MembershipResult` used by drop handling. */
type MembershipResultLike = { changed: number; results: { id: string; ok: boolean; error?: string | null }[] };
