import React from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { Briefcase } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

export type PortfolioProjectItem = {
  id: string;
  name: string;
  key: string;
  health: string | null;
  open_issues: number;
  done_issues: number;
  total_points: number;
  active_sprint: string | null;
  next_release: string | null;
};

export type PortfolioOverview = {
  projects: PortfolioProjectItem[];
  total_open_issues: number;
  total_done_issues: number;
};

const HEALTH_COLORS: Record<string, string> = {
  on_track: "#10b981",
  at_risk: "#f59e0b",
  off_track: "#ef4444",
};

export function PortfolioOverviewView() {
  const { session, setSelected } = useWorkspace();
  const overview = useQuery({
    queryKey: ["portfolio-overview"],
    queryFn: () => request<PortfolioOverview>(session.token, `/portfolio/overview`),
  });

  const data = overview.data;

  return (
    <Card className="portfolio-overview mt-4 space-y-4 p-4 sm:p-6">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-bold text-text-main">
            <Briefcase size={18} /> Cross-Project Portfolio
          </CardTitle>
          <p className="text-xs sm:text-sm text-text-subtle mt-1">
            Aggregated health, velocity and delivery progress across all active projects.
          </p>
        </div>
        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 bg-surface-2 rounded-lg border border-border text-xs text-text-main font-medium capitalize whitespace-nowrap">
              <strong>{data.projects.length}</strong> projects
            </span>
            <span className="px-2.5 py-1 bg-surface-2 rounded-lg border border-border text-xs text-text-main font-medium capitalize whitespace-nowrap">
              <strong>{data.total_open_issues}</strong> open
            </span>
            <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg border border-emerald-500/20 text-xs font-medium capitalize whitespace-nowrap">
              <strong>{data.total_done_issues}</strong> resolved
            </span>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {overview.isLoading && (
          <p className="text-xs text-text-subtle p-6 text-center">Loading portfolio roll-up…</p>
        )}

        {data && (
          <div className="overflow-x-auto border border-border rounded-xl">
            <table className="w-full text-left text-xs sm:text-sm border-collapse [&_th]:text-left [&_th]:px-1 [&_th]:py-1.5 [&_th]:border-b [&_th]:border-divider [&_td]:text-left [&_td]:px-1 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-divider">
              <thead className="bg-surface-2 border-b border-border text-text-subtle font-semibold uppercase text-[10px]">
                <tr>
                  <th className="p-3">Project</th>
                  <th className="p-3">Health</th>
                  <th className="p-3">Open Work</th>
                  <th className="p-3">Resolved</th>
                  <th className="p-3">Total Points</th>
                  <th className="p-3">Active Sprint</th>
                  <th className="p-3">Next Release</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.projects.map((p) => {
                  const total = p.open_issues + p.done_issues;
                  const progressPct = total > 0 ? Math.round((p.done_issues / total) * 100) : 0;
                  return (
                    <tr
                      key={p.id}
                      className="hover:bg-surface-2 transition-colors cursor-pointer"
                      onClick={() => setSelected(p.id)}
                      title={`Switch to ${p.name}`}
                    >
                      <td className="p-3">
                        <strong className="text-text-main">{p.name}</strong>{" "}
                        <span className="mono text-xs text-text-subtle">({p.key})</span>
                      </td>
                      <td className="p-3">
                        {p.health ? (
                          <span
                            className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full capitalize whitespace-nowrap bg-accent-soft text-accent-text"
                            style={{
                              background: `${HEALTH_COLORS[p.health] ?? "#6b7280"}20`,
                              color: HEALTH_COLORS[p.health] ?? "#6b7280",
                            }}
                          >
                            {p.health.replace("_", " ")}
                          </span>
                        ) : (
                          <span className="text-text-subtle text-[11px]">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-text-main">{p.open_issues} open</span>
                          <div className="w-16 h-1.5 bg-bg border border-border rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-text-subtle font-mono">{p.done_issues} done</td>
                      <td className="p-3 text-text-subtle font-mono">{p.total_points} pts</td>
                      <td className="p-3">
                        {p.active_sprint ? (
                          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 capitalize whitespace-nowrap px-[9px] py-1.5 rounded-md bg-surface-3">
                            {p.active_sprint}
                          </span>
                        ) : (
                          <span className="text-text-subtle text-[11px]">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {p.next_release ? (
                          <span className="text-xs font-medium text-accent capitalize whitespace-nowrap px-[9px] py-1.5 rounded-md bg-accent-soft">
                            {p.next_release}
                          </span>
                        ) : (
                          <span className="text-text-subtle text-[11px]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {data.projects.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-xs text-text-subtle">
                      No accessible projects found in this workspace.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
