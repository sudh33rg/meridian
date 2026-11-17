import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Search, ArrowUpRight } from "lucide-react";
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
import { Card, CardContent } from "../shared/UiComponents";

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
    <div className="space-y-6">
      {/* Controls Bar */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <div>
              <h2 id="backlog-title" className="text-lg sm:text-xl font-bold text-text-main m-0">
                Backlog
              </h2>
              <p className="text-xs text-text-muted m-0">
                Prioritize work and drag items directly into active or planned sprints.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Team Filter */}
            <div className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="font-semibold hidden sm:inline">Team:</span>
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border bg-surface-2 text-text-main"
              >
                <option value="">All teams</option>
                {teamList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Input */}
            <div className="relative min-w-[160px] sm:w-56">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search backlog…"
                maxLength={200}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs border border-border bg-surface-2 text-text-main placeholder-text-muted focus:outline-hidden"
              />
            </div>

            <button
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-surface-2 hover:bg-surface-3 text-text-main transition-colors cursor-pointer"
              onClick={() => setTab("sprints")}
            >
              <span>Sprints</span>
              <ArrowUpRight size={14} />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Grid: Backlog Items & Open Sprints */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Backlog List */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted">
              Product Backlog ({items.length})
            </h3>
            <span className="text-xs text-text-muted">Drag to rank · Alt + ↑/↓ to move</span>
          </div>

          <Card
            className="overflow-hidden"
            onDragOver={(e: React.DragEvent) => {
              if (!dragId) return;
              e.preventDefault();
            }}
            onDrop={(e: React.DragEvent) => {
              e.preventDefault();
              const id = dragId ?? e.dataTransfer.getData("text/plain");
              setDragId(null);
              setOverRow(null);
              if (id) rank(id, "bottom");
            }}
          >
            {backlog.isLoading && (
              <div className="p-8 text-center text-xs text-text-muted">Loading backlog…</div>
            )}
            {backlog.isError && (
              <div className="p-4 text-xs text-danger-text bg-danger-soft">Could not load the backlog.</div>
            )}

            <ol className="divide-y divide-border m-0 p-0 list-none">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  draggable
                  tabIndex={0}
                  aria-label={`${key}-${item.number} ${item.title}, rank ${index + 1} of ${items.length}`}
                  className={`p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors cursor-grab active:cursor-grabbing hover:bg-surface-2 ${
                    dragId === item.id ? "opacity-30 bg-accent-soft" : ""
                  } ${
                    overRow?.id === item.id
                      ? overRow.pos === "before"
                        ? "border-t-2 border-t-accent"
                        : "border-b-2 border-b-accent"
                      : ""
                  }`}
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
                  {/* Left info */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="text-text-subtle hover:text-text-main cursor-grab shrink-0">
                      <GripVertical size={16} />
                    </span>

                    <KindIcon kind={item.kind} size={15} />

                    <button
                      className="font-mono text-xs font-bold text-accent hover:underline shrink-0"
                      onClick={() => setSelectedIssue(item.id)}
                      tabIndex={-1}
                    >
                      {key}-{item.number}
                    </button>

                    <span className="text-xs sm:text-sm font-semibold text-text-main truncate">
                      {item.title}
                    </span>
                  </div>

                  {/* Right metadata and sprint assigner */}
                  <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                      {item.team_id && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-surface-2 text-text-muted whitespace-nowrap">
                          {teamName(teamList, item.team_id)}
                        </span>
                      )}
                      <span className="text-[11px] text-text-muted font-medium whitespace-nowrap">
                        {statusLabel(item.status)}
                      </span>
                      <PriorityIcon priority={item.priority} />
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-accent-soft text-accent whitespace-nowrap">
                        {item.story_points != null ? `${item.story_points} pt` : "–"}
                      </span>
                    </div>

                    <select
                      aria-label={`Move ${key}-${item.number} to a sprint`}
                      value=""
                      disabled={laneSprints.length === 0}
                      onChange={(e) => {
                        if (e.target.value) addToSprint(item.id, e.target.value);
                      }}
                      className="px-2 py-1 rounded-md text-[11px] font-medium border border-border bg-surface-2 text-text-main focus:outline-hidden"
                    >
                      <option value="">{laneSprints.length ? "To sprint…" : "No sprint"}</option>
                      {laneSprints.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
            </ol>

            {!backlog.isLoading && items.length === 0 && (
              <div className="py-16 text-center text-xs sm:text-sm text-text-muted">
                {search || teamFilter
                  ? "Nothing matches these filters."
                  : "The backlog is empty. Every issue is in a sprint, or completed."}
              </div>
            )}
          </Card>
        </div>

        {/* Right 1 Col: Open Sprints */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted">
              Open Sprints ({laneSprints.length})
            </h3>
          </div>

          <div className="space-y-3">
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
              <div className="p-8 text-center text-xs text-text-muted border border-dashed border-border rounded-xl">
                No active or planned sprint. Create one on the Sprints page.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
