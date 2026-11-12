import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Search } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { KindIcon, PriorityIcon } from "../work/meta";
import { SprintCard } from "./SprintCard";
import {
  type BacklogItem,
  type Sprint,
  invalidatePlanning,
  isOpenSprint,
  teamName,
  useTeams,
} from "./agile-shared";

type Placement = "top" | "bottom" | "before" | "after";

/** The product backlog (project-wide, ranked) with team filtering, drag ranking and sprint planning. */
export function BacklogTab() {
  const { session, selected, project, tab, setSelectedIssue, setError, setTab, statusLabel } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [teamFilter, setTeamFilter] = useState("");
  const [q, setQ] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overRow, setOverRow] = useState<{ id: string; pos: "before" | "after" } | null>(null);
  const active = tab === "backlog" && !!selected;
  const teams = useTeams(session.token, active);
  const teamList = teams.data ?? [];
  const search = q.trim();
  const backlog = useQuery({
    queryKey: ["backlog", selected, teamFilter, search],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "500" });
      if (teamFilter) params.set("team_id", teamFilter);
      if (search) params.set("q", search);
      return request<BacklogItem[]>(session.token, `/projects/${selected}/backlog?${params.toString()}`);
    },
    enabled: active,
  });
  const sprints = useQuery({
    queryKey: ["sprints", selected],
    queryFn: () => request<Sprint[]>(session.token, `/projects/${selected}/sprints`),
    enabled: active,
  });
  if (!active) return null;

  const items = backlog.data ?? [];
  const laneSprints = (sprints.data ?? [])
    .filter(isOpenSprint)
    .filter((s) => !teamFilter || s.team_id === teamFilter);
  const key = project?.key ?? "";

  const rank = async (issueId: string, placement: Placement, anchor?: string) => {
    try {
      await send(`/issues/${issueId}/rank`, session.token, "POST", {
        placement,
        anchor_id: anchor ?? null,
      });
      await invalidatePlanning(qc, selected);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const addToSprint = async (issueId: string, sprintId: string) => {
    try {
      const res = await send<{
        changed: number;
        results: { id: string; ok: boolean; error?: string | null }[];
      }>(`/sprints/${sprintId}/issues`, session.token, "POST", { issue_ids: [issueId] });
      const refused = res.results.find((r) => !r.ok);
      if (refused?.error) setError(refused.error);
      else toast("Moved to sprint");
      await invalidatePlanning(qc, selected);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="planning backlog" aria-labelledby="backlog-title">
      <div className="planning-head">
        <div>
          <h2 id="backlog-title">Backlog</h2>
          <p className="muted small hide-sm">
            Drag to rank, or focus a row and press Alt + ↑ / ↓. Drop onto a sprint to plan it.
          </p>
        </div>
        <label className="small">
          Team
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">All teams</option>
            {teamList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field small">
          <Search size={14} aria-hidden />
          <span className="sr-only">Search backlog</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search backlog"
            maxLength={200}
          />
        </label>
        <button className="secondary" onClick={() => setTab("sprints")}>
          Sprints
        </button>
      </div>
      <div className="backlog-grid">
        <div
          className="backlog-list"
          aria-label="Product backlog"
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const id = dragId ?? e.dataTransfer.getData("text/plain");
            setDragId(null);
            setOverRow(null);
            if (id) rank(id, "bottom");
          }}
        >
          {backlog.isLoading && <p className="muted small">Loading backlog…</p>}
          {backlog.isError && <p className="error small">Could not load the backlog.</p>}
          <ol className="backlog-rows">
            {items.map((item, index) => (
              <li
                key={item.id}
                className={
                  "backlog-row" +
                  (dragId === item.id ? " dragging" : "") +
                  (overRow?.id === item.id ? ` over-${overRow.pos}` : "")
                }
                draggable
                tabIndex={0}
                aria-label={`${key}-${item.number} ${item.title}, rank ${index + 1} of ${items.length}`}
                onDragStart={(e) => {
                  setDragId(item.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", item.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverRow(null);
                }}
                onDragOver={(e) => {
                  if (!dragId || dragId === item.id) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const pos = e.clientY < r.top + r.height / 2 ? "before" : "after";
                  if (overRow?.id !== item.id || overRow.pos !== pos) setOverRow({ id: item.id, pos });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const id = dragId ?? e.dataTransfer.getData("text/plain");
                  const pos = overRow?.id === item.id ? overRow.pos : "before";
                  setDragId(null);
                  setOverRow(null);
                  if (id && id !== item.id) rank(id, pos, item.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target === e.currentTarget) setSelectedIssue(item.id);
                  if (!e.altKey) return;
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    const prev = items[index - 1];
                    if (prev) rank(item.id, "before", prev.id);
                    else rank(item.id, "top");
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    const next = items[index + 1];
                    if (next) rank(item.id, "after", next.id);
                    else rank(item.id, "bottom");
                  }
                }}
              >
                <span className="backlog-grip" aria-hidden>
                  <GripVertical size={14} />
                </span>
                <span className="backlog-key">
                  <KindIcon kind={item.kind} size={13} />
                  <button
                    className="issue-number-button"
                    onClick={() => setSelectedIssue(item.id)}
                    tabIndex={-1}
                  >
                    {key}-{item.number}
                  </button>
                </span>
                <span className="backlog-title">{item.title}</span>
                <span className="backlog-meta">
                  {item.team_id && <span className="chip">{teamName(teamList, item.team_id)}</span>}
                  <span className="small muted">{statusLabel(item.status)}</span>
                  <PriorityIcon priority={item.priority} />
                  <span className="small muted">
                    {item.story_points != null ? `${item.story_points} pt` : "–"}
                  </span>
                </span>
                <select
                  aria-label={`Move ${key}-${item.number} to a sprint`}
                  value=""
                  disabled={laneSprints.length === 0}
                  onChange={(e) => {
                    if (e.target.value) addToSprint(item.id, e.target.value);
                  }}
                >
                  <option value="">{laneSprints.length ? "To sprint…" : "No open sprint"}</option>
                  {laneSprints.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ol>
          {!backlog.isLoading && items.length === 0 && (
            <div className="empty-inline muted">
              {search || teamFilter
                ? "Nothing matches these filters."
                : "The backlog is empty. Every issue is in a sprint, or done."}
            </div>
          )}
          {dragId && (
            <div className="backlog-end-zone" aria-hidden>
              Drop here to rank last
            </div>
          )}
        </div>
        <div className="backlog-sprints" aria-label="Open sprints">
          <h3 className="section-title">Open sprints</h3>
          {laneSprints.map((s) => (
            <SprintCard
              key={s.id}
              compact
              projectId={selected}
              projectKey={key}
              sprint={s}
              sprints={sprints.data ?? []}
              teams={teamList}
            />
          ))}
          {!sprints.isLoading && laneSprints.length === 0 && (
            <div className="empty-inline muted">No open sprint. Create one on the Sprints page.</div>
          )}
        </div>
      </div>
    </section>
  );
}
