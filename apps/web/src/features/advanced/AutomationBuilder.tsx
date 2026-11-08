import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { errorMessage, request, send } from "../../lib/api";
import type { ProjectRef, Session } from "../../lib/types";
import { useToast } from "../shared/Toast";

type Condition = { field: string; op: string; value: string };
type Action = { type: string; value: string };

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger_event: string;
  action_type: string;
  schedule?: string | null;
  conditions: Condition[];
  actions: Action[];
  last_run_at?: string | null;
  next_run_at?: string | null;
};

type Run = { id: number; issue_number: number | null; issue_title: string | null; result: string; at: string };
type Preview = { checked: number; matching: number; sample: { key: string; title: string }[] };

const TRIGGERS: [string, string][] = [
  ["issue_created", "An issue is created"],
  ["issue_status_changed", "An issue's status changes"],
  ["issue_updated", "An issue is edited"],
  ["comment_added", "A comment is added"],
  ["scheduled", "On a schedule"],
];
const FIELDS = ["priority", "kind", "status", "label", "team_id", "assignee_id"];
const ACTIONS: [string, string][] = [
  ["set_priority", "Set priority"],
  ["set_status", "Set status"],
  ["set_assignee", "Set assignee"],
  ["add_label", "Add label"],
  ["comment", "Add a comment"],
  ["notify_admins", "Notify owners and admins"],
];
const PRIORITIES = ["low", "medium", "high", "urgent"];

const emptyCondition = (): Condition => ({ field: "priority", op: "eq", value: "high" });
const emptyAction = (): Action => ({ type: "set_priority", value: "high" });

/** Rules are the project's automations: conditions, up to five actions, and an optional schedule. */
export function AutomationBuilder({
  project,
  session,
  onError,
}: {
  project: ProjectRef;
  session: Session;
  onError: (msg: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const token = session.token;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("issue_status_changed");
  const [schedule, setSchedule] = useState("daily");
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [actions, setActions] = useState<Action[]>([{ type: "notify_admins", value: "" }]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [openRuns, setOpenRuns] = useState<string | null>(null);

  const rules = useQuery({
    queryKey: ["automations", project.id],
    queryFn: () => request<Rule[]>(token, `/projects/${project.id}/automations`),
  });
  const runs = useQuery({
    queryKey: ["automation-runs", openRuns],
    queryFn: () => request<Run[]>(token, `/automations/${openRuns}/runs`),
    enabled: !!openRuns,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["automations", project.id] });
  const fail = (e: unknown) => onError(errorMessage(e));

  const toggle = async (rule: Rule) => {
    try {
      await send(`/automations/${rule.id}`, token, "PATCH", { enabled: !rule.enabled });
      toast(rule.enabled ? "Rule turned off" : "Rule turned on");
      await refresh();
    } catch (e) {
      fail(e);
    }
  };
  const remove = async (rule: Rule) => {
    if (!window.confirm(`Delete the rule “${rule.name}” and its run log? This cannot be undone.`)) return;
    try {
      await send(`/automations/${rule.id}`, token, "DELETE");
      toast("Rule deleted");
      await refresh();
    } catch (e) {
      fail(e);
    }
  };
  const runPreview = async () => {
    try {
      const res = await send<Preview>(`/projects/${project.id}/automations/preview`, token, "POST", { conditions });
      setPreview(res);
    } catch (e) {
      fail(e);
    }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body: Record<string, unknown> = {
        name,
        trigger_event: trigger,
        action_type: "custom",
        conditions,
        actions: actions.map((a) => (a.type === "notify_admins" ? { type: a.type } : a)),
      };
      if (trigger === "scheduled") body.schedule = schedule;
      await send(`/projects/${project.id}/automations`, token, "POST", body);
      toast("Rule created");
      setCreating(false);
      setName("");
      setConditions([]);
      setActions([{ type: "notify_admins", value: "" }]);
      setPreview(null);
      await refresh();
    } catch (err) {
      fail(err);
    }
  };

  const updateAt = <T,>(list: T[], idx: number, patch: Partial<T>) =>
    list.map((item, i) => (i === idx ? { ...item, ...patch } : item));

  return (
    <section className="extended automation-builder">
      <div className="ext-title">
        <div>
          <div className="eyebrow blue">MERIDIAN / {project.key}</div>
          <h2>Automation rules</h2>
          <p>When something happens or on a schedule, check conditions and run up to five actions. Rules never start other rules.</p>
        </div>
        <div className="ext-actions">
          <button className="secondary" onClick={() => void refresh()}>
            <RefreshCcw size={15} /> Refresh
          </button>
          <button className="primary" onClick={() => setCreating(!creating)} aria-expanded={creating}>
            <Plus size={16} /> New rule
          </button>
        </div>
      </div>

      {creating && (
        <form className="panel automation-form" onSubmit={create} aria-label="New automation rule">
          <label>
            Rule name
            <input value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            When
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {TRIGGERS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {trigger === "scheduled" && (
            <label>
              Every
              <select value={schedule} onChange={(e) => setSchedule(e.target.value)}>
                <option value="hourly">hour</option>
                <option value="daily">day</option>
                <option value="weekly">week</option>
              </select>
            </label>
          )}

          <fieldset>
            <legend>If all of these hold (optional)</legend>
            {conditions.map((c, idx) => (
              <div className="automation-row" key={idx}>
                <select
                  aria-label={`Condition ${idx + 1} field`}
                  value={c.field}
                  onChange={(e) => setConditions(updateAt(conditions, idx, { field: e.target.value }))}
                >
                  {FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Condition ${idx + 1} operator`}
                  value={c.op}
                  onChange={(e) => setConditions(updateAt(conditions, idx, { op: e.target.value }))}
                >
                  <option value="eq">is</option>
                  <option value="neq">is not</option>
                </select>
                <input
                  aria-label={`Condition ${idx + 1} value`}
                  value={c.value}
                  maxLength={200}
                  placeholder={c.field.endsWith("_id") ? "id (team or member)" : "value"}
                  onChange={(e) => setConditions(updateAt(conditions, idx, { value: e.target.value }))}
                />
                <button type="button" className="secondary small-btn" onClick={() => setConditions(conditions.filter((_, i) => i !== idx))}>
                  Remove
                </button>
              </div>
            ))}
            {conditions.length < 10 && (
              <button type="button" className="secondary small-btn" onClick={() => setConditions([...conditions, emptyCondition()])}>
                Add condition
              </button>
            )}
          </fieldset>

          <fieldset>
            <legend>Then do</legend>
            {actions.map((a, idx) => (
              <div className="automation-row" key={idx}>
                <select
                  aria-label={`Action ${idx + 1} type`}
                  value={a.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    setActions(updateAt(actions, idx, { type, value: type === "set_priority" ? "high" : "" }));
                  }}
                >
                  {ACTIONS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                {a.type === "set_priority" ? (
                  <select
                    aria-label={`Action ${idx + 1} priority`}
                    value={a.value}
                    onChange={(e) => setActions(updateAt(actions, idx, { value: e.target.value }))}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                ) : a.type === "notify_admins" ? null : (
                  <input
                    aria-label={`Action ${idx + 1} value`}
                    value={a.value}
                    maxLength={2000}
                    placeholder={
                      a.type === "set_assignee"
                        ? "me, a member id, or empty to clear"
                        : a.type === "set_status"
                          ? "status key"
                          : a.type === "add_label"
                            ? "label"
                            : "text"
                    }
                    onChange={(e) => setActions(updateAt(actions, idx, { value: e.target.value }))}
                  />
                )}
                <button type="button" className="secondary small-btn" onClick={() => setActions(actions.filter((_, i) => i !== idx))}>
                  Remove
                </button>
              </div>
            ))}
            {actions.length < 5 && (
              <button type="button" className="secondary small-btn" onClick={() => setActions([...actions, emptyAction()])}>
                Add action
              </button>
            )}
          </fieldset>

          <div className="automation-buttons">
            <button type="button" className="secondary" onClick={() => void runPreview()}>
              <Play size={14} /> Preview matches
            </button>
            <button className="primary" type="submit" disabled={actions.length === 0}>
              Create rule
            </button>
          </div>
          {preview && (
            <p className="small" role="status">
              {preview.matching} of the last {preview.checked} open issues match now. Nothing has changed.
              {preview.sample.length > 0 && ` For example: ${preview.sample.map((s) => `${s.key} ${s.title}`).join("; ")}`}
            </p>
          )}
        </form>
      )}

      {rules.isLoading ? (
        <p className="muted">Loading rules…</p>
      ) : (rules.data ?? []).length === 0 ? (
        <p className="muted">No rules yet. Create one to automate routine changes.</p>
      ) : (
        <div className="table-scroll">
        <table className="automation-table">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">When</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rules.data ?? []).map((r) => (
              <React.Fragment key={r.id}>
                <tr>
                  <td>{r.name}</td>
                  <td>
                    {r.trigger_event === "scheduled" ? `Every ${r.schedule ?? "day"}` : r.trigger_event.replace(/_/g, " ")}
                    {r.trigger_event === "scheduled" && r.next_run_at && (
                      <span className="muted small"> · next {new Date(r.next_run_at).toLocaleString()}</span>
                    )}
                  </td>
                  <td>
                    <label className="small">
                      <input type="checkbox" checked={r.enabled} onChange={() => void toggle(r)} /> {r.enabled ? "On" : "Off"}
                    </label>
                  </td>
                  <td className="automation-cell-actions">
                    <button
                      className="secondary small-btn"
                      aria-expanded={openRuns === r.id}
                      onClick={() => setOpenRuns(openRuns === r.id ? null : r.id)}
                    >
                      Run log
                    </button>
                    <button className="secondary small-btn" onClick={() => void remove(r)} aria-label={`Delete rule ${r.name}`}>
                      <Trash2 size={14} /> Delete
                    </button>
                  </td>
                </tr>
                {openRuns === r.id && (
                  <tr>
                    <td colSpan={4}>
                      {runs.isLoading ? (
                        <span className="muted">Loading…</span>
                      ) : (runs.data ?? []).length === 0 ? (
                        <span className="muted">This rule has not run yet.</span>
                      ) : (
                        <ul className="small">
                          {(runs.data ?? []).map((run) => (
                            <li key={run.id}>
                              {new Date(run.at).toLocaleString()} · {run.issue_number ? `#${run.issue_number} ${run.issue_title ?? ""}` : "issue removed"} · {run.result}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}
