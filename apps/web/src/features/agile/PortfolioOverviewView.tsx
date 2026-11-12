import React from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { Briefcase } from "lucide-react";

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
    <div className="portfolio-overview" style={{ marginTop: 16 }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}
      >
        <div>
          <h3 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
            <Briefcase size={20} /> Cross-Project Portfolio
          </h3>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            Aggregated health, velocity and delivery progress across all active projects.
          </p>
        </div>
        {data && (
          <div style={{ display: "flex", gap: 12 }}>
            <span className="chip">
              <strong>{data.projects.length}</strong> projects
            </span>
            <span className="chip">
              <strong>{data.total_open_issues}</strong> open issues
            </span>
            <span className="chip success">
              <strong>{data.total_done_issues}</strong> resolved
            </span>
          </div>
        )}
      </div>

      {overview.isLoading && <p className="muted small">Loading portfolio roll-up…</p>}

      {data && (
        <div style={{ overflowX: "auto" }}>
          <table className="simple-table" style={{ width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th>Project</th>
                <th>Health</th>
                <th>Open Work</th>
                <th>Resolved</th>
                <th>Total Points</th>
                <th>Active Sprint</th>
                <th>Next Release</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => {
                const total = p.open_issues + p.done_issues;
                const progressPct = total > 0 ? Math.round((p.done_issues / total) * 100) : 0;
                return (
                  <tr
                    key={p.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected(p.id)}
                    title={`Switch to ${p.name}`}
                  >
                    <td>
                      <strong>{p.name}</strong> <span className="mono muted">({p.key})</span>
                    </td>
                    <td>
                      {p.health ? (
                        <span
                          className="chip small"
                          style={{
                            background: `${HEALTH_COLORS[p.health] ?? "#6b7280"}20`,
                            color: HEALTH_COLORS[p.health] ?? "#6b7280",
                            fontWeight: 600,
                          }}
                        >
                          {p.health.replace("_", " ")}
                        </span>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{p.open_issues} open</span>
                        <div
                          style={{
                            width: 60,
                            height: 6,
                            background: "var(--border)",
                            borderRadius: 3,
                            overflow: "hidden",
                          }}
                        >
                          <div style={{ width: `${progressPct}%`, height: "100%", background: "#10b981" }} />
                        </div>
                      </div>
                    </td>
                    <td>{p.done_issues} done</td>
                    <td>{p.total_points} pts</td>
                    <td>
                      {p.active_sprint ? (
                        <span className="chip small success">{p.active_sprint}</span>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    <td>
                      {p.next_release ? (
                        <span className="chip small">{p.next_release}</span>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.projects.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 24 }} className="muted">
                    No accessible projects found in this workspace.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
