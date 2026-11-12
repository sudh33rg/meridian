import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request, send, errorMessage } from "../../lib/api";
import { useWorkspace } from "../workspace/useWorkspace";
import { useToast } from "../shared/Toast";
import { X, Save, Clock } from "lucide-react";

export type SprintMemberCapacity = {
  user_id: string;
  name: string;
  email: string;
  capacity_hours: number;
  assigned_points: number;
};

export type SprintCapacityView = {
  sprint_id: string;
  total_capacity_hours: number;
  total_assigned_points: number;
  members: SprintMemberCapacity[];
};

export function SprintCapacityModal({
  sprintId,
  sprintName,
  onClose,
}: {
  sprintId: string;
  sprintName: string;
  onClose: () => void;
}) {
  const { session, setError } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [capacities, setCapacities] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);

  const cap = useQuery({
    queryKey: ["sprint-capacity", sprintId],
    queryFn: async () => {
      const data = await request<SprintCapacityView>(session.token, `/sprints/${sprintId}/capacity`);
      const map: Record<string, number> = {};
      for (const m of data.members) {
        map[m.user_id] = m.capacity_hours;
      }
      setCapacities(map);
      return data;
    },
  });

  const saveCapacities = async () => {
    try {
      const payload = {
        capacities: Object.entries(capacities).map(([user_id, capacity_hours]) => ({
          user_id,
          capacity_hours: Number(capacity_hours) || 0,
        })),
      };
      await send(`/sprints/${sprintId}/capacity`, session.token, "PUT", payload);
      toast("Sprint capacities updated");
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["sprint-capacity", sprintId] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const data = cap.data;

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Sprint Capacity"
    >
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <h3>Sprint Capacity: {sprintName}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {cap.isLoading && <p className="muted small">Loading capacities…</p>}

        {data && (
          <div>
            <div
              style={{
                display: "flex",
                gap: 16,
                marginBottom: 16,
                padding: 12,
                background: "var(--bg-subtle)",
                borderRadius: 6,
              }}
            >
              <div>
                <span className="small muted">Total Team Capacity</span>
                <strong style={{ display: "block", fontSize: 18 }}>
                  <Clock size={16} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  {data.total_capacity_hours} hrs
                </strong>
              </div>
              <div>
                <span className="small muted">Assigned Scope</span>
                <strong style={{ display: "block", fontSize: 18 }}>{data.total_assigned_points} pts</strong>
              </div>
            </div>

            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginBottom: 16 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Member</th>
                  <th style={{ padding: "6px 8px" }}>Assigned Pts</th>
                  <th style={{ padding: "6px 8px", width: 140 }}>Available Hours</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.user_id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "6px 8px" }}>
                      <strong>{m.name}</strong>
                      <div className="small muted">{m.email}</div>
                    </td>
                    <td style={{ padding: "6px 8px" }}>{m.assigned_points} pts</td>
                    <td style={{ padding: "6px 8px" }}>
                      <input
                        type="number"
                        min="0"
                        max="200"
                        step="0.5"
                        value={capacities[m.user_id] ?? m.capacity_hours}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setCapacities((prev) => ({ ...prev, [m.user_id]: val }));
                          setDirty(true);
                        }}
                        style={{ width: "100%", padding: "4px 8px" }}
                      />
                    </td>
                  </tr>
                ))}
                {data.members.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: 12, textAlign: "center" }} className="muted">
                      No team members found for this sprint.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="secondary small-btn" onClick={onClose}>
                Cancel
              </button>
              <button className="primary small-btn" onClick={saveCapacities} disabled={!dirty}>
                <Save size={14} /> Save Capacities
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
