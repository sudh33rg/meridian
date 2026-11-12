import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Plus } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { SprintCard } from "./SprintCard";
import { TeamVelocityModal } from "./TeamVelocityModal";
import { type Sprint, type Velocity, invalidatePlanning, isOpenSprint, useTeams } from "./agile-shared";

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
  // Every open sprint, then the six most recently created closed ones.
  const visible = [...ranked.filter(isOpenSprint), ...ranked.filter((s) => !isOpenSprint(s)).slice(0, 6)];
  const teamList = teams.data ?? [];

  return (
    <section className="planning" aria-labelledby="sprints-title">
      <div className="planning-head">
        <div>
          <h2 id="sprints-title">Sprints</h2>
          <p className="muted small">
            {project?.name}. One active sprint per team; work moves between sprints and the backlog.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label className="small" style={{ margin: 0 }}>
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
          <button
            className="secondary"
            onClick={() => setShowVelocityModal(true)}
            aria-label="View Team Velocity"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <BarChart3 size={15} /> Team Velocity
          </button>
          {velocity.data && velocity.data.sprints.length > 0 && (
            <button
              className="chip"
              onClick={() => setShowVelocityModal(true)}
              aria-label="Average velocity"
              style={{ cursor: "pointer", border: "none" }}
              title="Click to view full velocity chart & predictability report"
            >
              Velocity {Math.round(velocity.data.average_done_points)} pts over {velocity.data.sprints.length}{" "}
              sprints
            </button>
          )}
        </div>
      </div>
      <form
        className="sprint-create"
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
      >
        <label className="small">
          Sprint name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={250} />
        </label>
        <label className="small">
          Goal
          <input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={2000} />
        </label>
        <label className="small">
          Team
          <select value={newTeam || teamFilter} onChange={(e) => setNewTeam(e.target.value)}>
            <option value="">Project (any team)</option>
            {teamList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={!name.trim()}>
          <Plus size={15} /> Create sprint
        </button>
      </form>
      <div className="sprint-list">
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
          <div className="empty-inline muted">
            No sprints yet. Create one above, then move work from the backlog into it.
          </div>
        )}
      </div>

      {showVelocityModal && selected && (
        <TeamVelocityModal
          projectId={selected}
          projectKey={project?.key ?? ""}
          projectName={project?.name}
          initialTeamId={teamFilter}
          onClose={() => setShowVelocityModal(false)}
        />
      )}
    </section>
  );
}
