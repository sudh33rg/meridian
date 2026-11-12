import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeamVelocityChart } from "./TeamVelocityModal";
import type { Velocity } from "./agile-shared";

describe("TeamVelocityChart", () => {
  it("renders empty state when there are no completed sprints", () => {
    const emptyVelocity: Velocity = {
      window: 5,
      average_done_count: 0,
      average_done_points: 0,
      average_started_count: 0,
      average_started_points: 0,
      predictability_pct: 0,
      sprints: [],
      team_id: null,
    };

    render(<TeamVelocityChart velocity={emptyVelocity} />);
    expect(screen.getByText("No completed sprints yet")).toBeInTheDocument();
  });

  it("renders chart with sprint commitment and delivery data", () => {
    const sampleVelocity: Velocity = {
      window: 5,
      average_done_count: 4,
      average_done_points: 20,
      average_started_count: 5,
      average_started_points: 25,
      predictability_pct: 80,
      sprints: [
        {
          sprint_id: "sprint-1",
          name: "Sprint Alpha",
          team_id: null,
          team_name: null,
          closed_at: "2026-11-10T00:00:00Z",
          started_scope_points: 25,
          final_scope_points: 25,
          final_done_points: 20,
          started_scope_count: 5,
          final_scope_count: 5,
          final_done_count: 4,
          carried_over_count: 1,
        },
      ],
      team_id: null,
    };

    render(<TeamVelocityChart velocity={sampleVelocity} metric="points" />);
    // Sprint name is rendered on the x-axis
    expect(screen.getByText("Sprint Alpha")).toBeInTheDocument();
    // Legend labels
    expect(screen.getByText("Committed Scope")).toBeInTheDocument();
    expect(screen.getByText("Completed Scope")).toBeInTheDocument();
    expect(screen.getByText("Average Velocity")).toBeInTheDocument();
    expect(screen.getByText("Avg 20")).toBeInTheDocument();
  });
});
