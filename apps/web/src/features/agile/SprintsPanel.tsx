import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Plus, TrendingUp } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { SprintCard } from "./SprintCard";
import { TeamVelocityModal } from "./TeamVelocityModal";
import { type Sprint, type Velocity, invalidatePlanning, isOpenSprint, useTeams } from "./agile-shared";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

const ORDER: Record<string, number> = { active: 0, planned: 1, completed: 2 };

/** The sprints tab: plan, start and close sprints for the project or for one team. */
export function SprintsPanel() {
  const { session, selected, project, setError, tab } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [teamFilter, setTeamFilter] = useState("");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [showVelocityModal, setShowVelocityModal] = useState(false);

  const active = tab === "sprints" && !!selected;
  const teams = useTeams(session.token, active);
  const sprints = useQuery({
    queryKey: ["sprints", selected],
    queryFn: () => request<Sprint[]>(session.token, `/projects/${selected}/sprints`),
    enabled: active,
  });
  const velocity = useQuery({
    queryKey: ["velocity", selected, teamFilter],
    queryFn: () =>
      request<Velocity>(
        session.token,
        `/projects/${selected}/velocity?sprints=5${teamFilter ? `&team_id=${teamFilter}` : ""}`,
      ),
    enabled: active,
  });

  if (!active) return null;

  const ranked = (sprints.data ?? [])
    .filter((s) => !teamFilter || s.team_id === teamFilter)
    .sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || (a.created_at < b.created_at ? 1 : -1));

  const visible = [...ranked.filter(isOpenSprint), ...ranked.filter((s) => !isOpenSprint(s)).slice(0, 6)];
  const teamList = teams.data ?? [];

  return (
    <div className="space-y-6">
      {/* Sprints Toolbar */}
      <Card>
        <CardContent className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 id="sprints-title" className="text-xl sm:text-2xl font-bold text-text-main m-0">
              Sprints & Iterations
            </h2>
            <p className="text-xs sm:text-sm text-text-muted mt-0.5 m-0">
              {project?.name}. Run focused cycles, estimate velocity, and measure team predictability.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
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

            <button
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-border bg-surface-2 text-text-main hover:bg-surface-3 transition-colors cursor-pointer"
              onClick={() => setShowVelocityModal(true)}
              aria-label="View Team Velocity"
            >
              <BarChart3 size={15} className="text-accent" />
              <span>Team Velocity</span>
            </button>

            {velocity.data && velocity.data.sprints.length > 0 && (
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-accent-soft text-accent border border-accent/20 hover:bg-accent-soft-2 transition-colors cursor-pointer"
                onClick={() => setShowVelocityModal(true)}
                title="Click to view full velocity chart & predictability report"
              >
                <TrendingUp size={13} />
                <span>
                  Avg {Math.round(velocity.data.average_done_points)} pts ({velocity.data.sprints.length}{" "}
                  sprints)
                </span>
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Create Sprint Card */}
      <Card>
        <CardHeader className="py-3 px-4 sm:px-6">
          <CardTitle className="text-sm">Create New Sprint</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!selected || !name.trim()) return;
              try {
                await send(`/projects/${selected}/sprints`, session.token, "POST", {
                  name: name.trim(),
                  goal,
                  team_id: newTeam || teamFilter || null,
                });
                setName("");
                setGoal("");
                toast("Sprint created");
                await invalidatePlanning(qc, selected);
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1">
                Sprint name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={250}
                placeholder="Sprint 24 — Delivery"
                className="w-full px-3 py-2 rounded-lg text-xs border border-border bg-surface-2 text-text-main placeholder-text-muted focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1">
                Goal (optional)
              </label>
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                maxLength={2000}
                placeholder="What is the objective?"
                className="w-full px-3 py-2 rounded-lg text-xs border border-border bg-surface-2 text-text-main placeholder-text-muted focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1">
                Team
              </label>
              <select
                value={newTeam || teamFilter}
                onChange={(e) => setNewTeam(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs border border-border bg-surface-2 text-text-main focus:outline-hidden"
              >
                <option value="">Project (any team)</option>
                {teamList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={!name.trim()}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-accent hover:bg-accent-strong active:bg-accent-strong transition-colors cursor-pointer disabled:opacity-50"
            >
              <Plus size={15} /> Create sprint
            </button>
          </form>
        </CardContent>
      </Card>

      {/* Sprints List */}
      <div className="space-y-4">
        {visible.map((s) => (
          <SprintCard
            key={s.id}
            projectId={selected}
            projectKey={project?.key ?? ""}
            sprint={s}
            sprints={sprints.data ?? []}
            teams={teamList}
          />
        ))}
        {!sprints.isLoading && visible.length === 0 && (
          <div className="py-16 text-center text-xs sm:text-sm text-text-muted border border-dashed border-border rounded-2xl bg-surface/40">
            No sprints yet. Create one above, then plan issues from the backlog.
          </div>
        )}
      </div>

      {/* Velocity Modal */}
      {showVelocityModal && selected && (
        <TeamVelocityModal
          projectId={selected}
          projectKey={project?.key ?? ""}
          projectName={project?.name}
          initialTeamId={teamFilter}
          onClose={() => setShowVelocityModal(false)}
        />
      )}
    </div>
  );
}
