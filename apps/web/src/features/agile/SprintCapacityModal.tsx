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
      className="overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Sprint Capacity"
    >
      <div className="modal max-w-lg w-full max-h-[90vh] flex flex-col gap-4 p-4 sm:p-6 bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="modal-head flex items-start justify-between gap-4 pb-2 border-b border-border">
          <h3 className="text-base sm:text-lg font-bold text-text">Sprint Capacity: {sprintName}</h3>
          <button
            className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer inline-grid place-items-center"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {cap.isLoading && <p className="text-xs text-muted">Loading capacities…</p>}

        {data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 p-3 bg-surface-2 rounded-xl border border-border">
              <div>
                <span className="text-xs text-muted font-medium block">Total Team Capacity</span>
                <strong className="text-base sm:text-lg font-bold text-text flex items-center gap-1.5 mt-0.5">
                  <Clock size={16} className="text-accent" />
                  {data.total_capacity_hours} hrs
                </strong>
              </div>
              <div>
                <span className="text-xs text-muted font-medium block">Assigned Scope</span>
                <strong className="text-base sm:text-lg font-bold text-text block mt-0.5">
                  {data.total_assigned_points} pts
                </strong>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[50vh] rounded-xl border border-border">
              <table className="w-full text-xs text-left">
                <thead className="bg-surface-2 border-b border-border sticky top-0">
                  <tr className="text-muted font-medium">
                    <th className="py-2.5 px-3">Member</th>
                    <th className="py-2.5 px-3">Assigned Pts</th>
                    <th className="py-2.5 px-3 w-36">Available Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.members.map((m) => (
                    <tr key={m.user_id} className="hover:bg-surface-2 transition-colors">
                      <td className="py-2 px-3">
                        <strong className="font-semibold text-text block">{m.name}</strong>
                        <div className="text-[11px] text-muted">{m.email}</div>
                      </td>
                      <td className="py-2 px-3 font-medium text-text">{m.assigned_points} pts</td>
                      <td className="py-2 px-3">
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
                          className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface text-text text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                        />
                      </td>
                    </tr>
                  ))}
                  {data.members.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-xs text-muted">
                        No team members found for this sprint.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] text-text-muted hover:text-text-main"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-accent hover:bg-accent-strong transition-colors cursor-pointer disabled:opacity-50 justify-center whitespace-nowrap duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px] shadow-[var(--shadow-sm)]"
                onClick={saveCapacities}
                disabled={!dirty}
              >
                <Save size={14} /> Save Capacities
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
