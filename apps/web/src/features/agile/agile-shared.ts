import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { components } from "../../api-schema";
import { request } from "../../lib/api";

/** Wire types for the Phase E planning endpoints come from the generated schema. */
type S = components["schemas"];
export type BacklogItem = S["BacklogItem"];
export type Sprint = S["Sprint"];
export type SprintDetail = S["SprintDetail"];
export type SprintTotals = S["SprintTotals"];
export type Burndown = S["Burndown"];
export type Velocity = S["Velocity"];
export type Release = S["Release"];
export type ReleaseDetail = S["ReleaseDetail"];
export type ReleaseScopeItem = S["ReleaseScopeItem"];
export type ScopeEvent = S["ScopeEvent"];
export type ReleaseNotes = S["ReleaseNotes"];
export type MembershipResult = S["MembershipResult"];

/** `GET /api/teams` rows. */
export type Team = { id: string; name: string; description: string; members: number };

export const isOpenSprint = (s: Sprint) => s.state === "planned" || s.state === "active";

export function useTeams(token: string, enabled = true) {
  return useQuery({
    queryKey: ["teams"],
    queryFn: () => request<Team[]>(token, "/teams"),
    enabled,
    staleTime: 60_000,
  });
}

/** Refreshes every planning query of a project after a change to backlog, sprints or releases. */
export function invalidatePlanning(qc: QueryClient, projectId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["backlog", projectId] }),
    qc.invalidateQueries({ queryKey: ["sprints", projectId] }),
    qc.invalidateQueries({ queryKey: ["sprint"] }),
    qc.invalidateQueries({ queryKey: ["burndown"] }),
    qc.invalidateQueries({ queryKey: ["velocity", projectId] }),
    qc.invalidateQueries({ queryKey: ["releases", projectId] }),
    qc.invalidateQueries({ queryKey: ["release"] }),
    qc.invalidateQueries({ queryKey: ["issues"] }),
  ]);
}

export function teamName(teams: Team[] | undefined, id?: string | null) {
  if (!id) return "";
  return teams?.find((t) => t.id === id)?.name ?? "Team";
}

export function formatPoints(n: number | null | undefined) {
  return `${n ?? 0} pts`;
}

export function shortDay(value?: string | null) {
  if (!value) return "";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const SPRINT_STATE_LABEL: Record<string, string> = {
  planned: "Planned",
  active: "Active",
  completed: "Closed",
};
