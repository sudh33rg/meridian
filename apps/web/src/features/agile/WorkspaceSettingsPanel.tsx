import React, { useState } from "react";
import { AiSettingsCard } from "./AiSettingsCard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";

type Settings = { timezone: string; working_days: number[]; week_start: number; default_sprint_days: number; locale: string };

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

/** Workspace-wide defaults: time zone, working days, week start and sprint length. Admins edit them. */
export function WorkspaceSettingsPanel() {
  const { session, setError, me } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["workspace-settings"],
    queryFn: () => request<Settings>(session.token, "/workspace/settings"),
  });
  const [draft, setDraft] = useState<Settings | null>(null);
  const current = draft ?? settings.data;
  const admin = me?.role === "owner" || me?.role === "admin";
  if (!current) return null;
  return (
    <section className="panel integrations" aria-labelledby="ws-title">
      <h3 id="ws-title">Workspace settings</h3>
      <AiSettingsCard token={session.token} admin={admin} />
      <div className="form-row">
        <label>
          Time zone
          <input
            value={current.timezone}
            disabled={!admin}
            maxLength={64}
            onChange={(e) => setDraft({ ...current, timezone: e.target.value })}
          />
        </label>
        <label>
          Language
          <select
            value={current.locale}
            disabled={!admin}
            onChange={(e) => setDraft({ ...current, locale: e.target.value })}
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
        <label>
          Week starts on
          <select
            value={current.week_start}
            disabled={!admin}
            onChange={(e) => setDraft({ ...current, week_start: Number(e.target.value) })}
          >
            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, n) => (
              <option key={d} value={n}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          Default sprint length (days)
          <input
            type="number"
            min={1}
            max={60}
            value={current.default_sprint_days}
            disabled={!admin}
            onChange={(e) => setDraft({ ...current, default_sprint_days: Number(e.target.value) })}
          />
        </label>
      </div>
      <fieldset className="small">
        <legend>Working days</legend>
        {DAYS.map(([n, label]) => (
          <label key={n} className="check-chip">
            <input
              type="checkbox"
              checked={current.working_days.includes(n)}
              disabled={!admin}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...current.working_days, n]
                  : current.working_days.filter((d) => d !== n);
                setDraft({ ...current, working_days: next.sort() });
              }}
            />{" "}
            {label}
          </label>
        ))}
      </fieldset>
      {admin ? (
        <button
          className="primary small-btn"
          disabled={!draft}
          onClick={async () => {
            if (!draft) return;
            try {
              await send("/workspace/settings", session.token, "PUT", draft);
              setDraft(null);
              await qc.invalidateQueries({ queryKey: ["workspace-settings"] });
              toast("Workspace settings saved");
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          Save settings
        </button>
      ) : (
        <p className="muted small">Only owners and admins can change these.</p>
      )}
    </section>
  );
}
