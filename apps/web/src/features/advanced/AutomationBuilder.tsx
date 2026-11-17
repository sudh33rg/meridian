import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Plus, Trash2 } from "lucide-react";
import { errorMessage, request, send } from "../../lib/api";
import type { ProjectRef, Session } from "../../lib/types";
import { useToast } from "../shared/Toast";
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

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

type Run = {
  id: number;
  issue_number: number | null;
  issue_title: string | null;
  result: string;
  at: string;
};
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
  onError: (message: string) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const token = session.token;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("issue_created");
  const [schedule, setSchedule] = useState("day");
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [actions, setActions] = useState<Action[]>([emptyAction()]);
  const [openRuns, setOpenRuns] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const rules = useQuery({
    queryKey: ["automation-rules", project.id],
    queryFn: () => request<Rule[]>(token, `/projects/${project.id}/automation/rules`),
  });

  const runs = useQuery({
    queryKey: ["automation-runs", openRuns],
    queryFn: () => request<Run[]>(token, `/automation/rules/${openRuns}/runs`),
    enabled: !!openRuns,
  });

  const reset = () => {
    setName("");
    setTrigger("issue_created");
    setSchedule("day");
    setConditions([]);
    setActions([emptyAction()]);
    setPreview(null);
    setCreating(false);
  };

  const createRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || actions.length === 0) return;
    try {
      await send(`/projects/${project.id}/automation/rules`, token, "POST", {
        name: name.trim(),
        trigger_event: trigger,
        action_type: actions[0]?.type ?? "set_priority",
        schedule: trigger === "scheduled" ? schedule : null,
        conditions,
        actions,
      });
      toast("Rule created");
      reset();
      await qc.invalidateQueries({ queryKey: ["automation-rules", project.id] });
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const toggle = async (r: Rule) => {
    try {
      await send(`/automation/rules/${r.id}`, token, "PATCH", { enabled: !r.enabled });
      await qc.invalidateQueries({ queryKey: ["automation-rules", project.id] });
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const remove = async (r: Rule) => {
    if (!window.confirm(`Delete rule "${r.name}"?`)) return;
    try {
      await send(`/automation/rules/${r.id}`, token, "DELETE");
      toast("Rule deleted");
      await qc.invalidateQueries({ queryKey: ["automation-rules", project.id] });
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const runPreview = async () => {
    try {
      const p = await send<Preview>(`/projects/${project.id}/automation/preview`, token, "POST", {
        conditions,
      });
      setPreview(p);
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  function updateAt<T>(arr: T[], idx: number, patch: Partial<T>): T[] {
    return arr.map((item, i) => (i === idx ? { ...item, ...patch } : item));
  }

  return (
    <section className="automation-panel space-y-6" aria-labelledby="auto-title">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 [&>div:first-child]:flex-[1_1_260px] [&>div:first-child]:min-w-0 [&_h2]:mt-0 [&_h2]:mb-0.5 [&_h2]:text-lg [&_p]:m-0">
        <PageHeader
          title="Automation"
          subtitle="Keep work moving automatically when issues change or on a recurring schedule."
          actions={
            <button
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs sm:text-sm font-medium transition-colors shadow-sm justify-center whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)]"
              onClick={() => setCreating((v) => !v)}
              aria-expanded={creating}
            >
              <Plus size={16} /> {creating ? "Close builder" : "New rule"}
            </button>
          }
        />
        <h2 id="auto-title" className="sr-only">
          Automation
        </h2>
      </div>

      {creating && (
        <Card className="space-y-5 p-4 sm:p-6 grid gap-3 mb-4 [&_fieldset]:grid [&_fieldset]:gap-2 [&_fieldset]:px-3 [&_fieldset]:py-2.5 [&_fieldset]:rounded-[10px] [&_fieldset]:border [&_fieldset]:border-current [&_fieldset]:opacity-95 [&_legend]:px-1 [&_legend]:text-[0.85rem]">
          <CardHeader className="pb-2 border-b border-border">
            <CardTitle className="text-base font-bold text-text-main">Create Automation Rule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <form onSubmit={createRule} className="space-y-4">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-text-subtle">Rule name</span>
                <input
                  aria-label="Rule name"
                  value={name}
                  maxLength={120}
                  placeholder="e.g. Escalate urgent bugs to triage"
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-text-subtle">When this happens</span>
                  <select
                    aria-label="Trigger"
                    value={trigger}
                    onChange={(e) => setTrigger(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main"
                  >
                    {TRIGGERS.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                {trigger === "scheduled" && (
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-text-subtle">Schedule</span>
                    <select
                      aria-label="Schedule"
                      value={schedule}
                      onChange={(e) => setSchedule(e.target.value)}
                      className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main"
                    >
                      <option value="hour">Every hour</option>
                      <option value="day">Every day</option>
                      <option value="week">Every week</option>
                    </select>
                  </label>
                )}
              </div>

              {/* Conditions */}
              <fieldset className="p-3 bg-surface-2 rounded-xl border border-border space-y-2">
                <legend className="text-xs font-bold uppercase tracking-wider text-text-subtle px-1">
                  And these match
                </legend>
                {conditions.map((c, idx) => (
                  <div className="flex flex-wrap items-center gap-2 [&_input]:min-w-40" key={idx}>
                    <select
                      aria-label={`Condition ${idx + 1} field`}
                      value={c.field}
                      onChange={(e) => setConditions(updateAt(conditions, idx, { field: e.target.value }))}
                      className="px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-main"
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
                      className="px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-main"
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
                      className="flex-1 min-w-[120px] px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-main"
                    />
                    <button
                      type="button"
                      className="px-2 py-1 bg-surface hover:bg-danger/10 hover:text-danger border border-border rounded-lg text-xs inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] text-text-muted"
                      onClick={() => setConditions(conditions.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {conditions.length < 10 && (
                  <button
                    type="button"
                    className="px-3 py-1 bg-surface hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] hover:text-text-main"
                    onClick={() => setConditions([...conditions, emptyCondition()])}
                  >
                    Add condition
                  </button>
                )}
              </fieldset>

              {/* Actions */}
              <fieldset className="p-3 bg-surface-2 rounded-xl border border-border space-y-2">
                <legend className="text-xs font-bold uppercase tracking-wider text-text-subtle px-1">
                  Then do
                </legend>
                {actions.map((a, idx) => (
                  <div className="flex flex-wrap items-center gap-2 [&_input]:min-w-40" key={idx}>
                    <select
                      aria-label={`Action ${idx + 1} type`}
                      value={a.type}
                      onChange={(e) => {
                        const type = e.target.value;
                        setActions(
                          updateAt(actions, idx, { type, value: type === "set_priority" ? "high" : "" }),
                        );
                      }}
                      className="px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-main"
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
                        className="px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-main"
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
                        className="flex-1 min-w-[120px] px-2.5 py-1.5 bg-surface border border-border rounded-lg text-xs text-text-main"
                      />
                    )}
                    <button
                      type="button"
                      className="px-2 py-1 bg-surface hover:bg-danger/10 hover:text-danger border border-border rounded-lg text-xs inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] text-text-muted"
                      onClick={() => setActions(actions.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {actions.length < 5 && (
                  <button
                    type="button"
                    className="px-3 py-1 bg-surface hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] hover:text-text-main"
                    onClick={() => setActions([...actions, emptyAction()])}
                  >
                    Add action
                  </button>
                )}
              </fieldset>

              <div className="flex items-center gap-2 pt-2 border-t border-border flex-wrap">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs sm:text-sm font-medium text-text-main transition-colors justify-center whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main"
                  onClick={() => void runPreview()}
                >
                  <Play size={14} /> Preview matches
                </button>
                <button
                  className="px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs sm:text-sm font-medium transition-colors disabled:opacity-50 shadow-sm inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)]"
                  type="submit"
                  disabled={actions.length === 0}
                >
                  Create rule
                </button>
              </div>

              {preview && (
                <p
                  className="text-xs text-text-subtle p-3 bg-surface-2 rounded-xl border border-border"
                  role="status"
                >
                  {preview.matching} of the last {preview.checked} open issues match now. Nothing has changed.
                  {preview.sample.length > 0 &&
                    ` For example: ${preview.sample.map((s) => `${s.key} ${s.title}`).join("; ")}`}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {/* Rules Table */}
      {rules.isLoading ? (
        <p className="text-xs text-text-subtle p-6 text-center">Loading rules…</p>
      ) : (rules.data ?? []).length === 0 ? (
        <Card className="p-8 text-center text-xs text-text-subtle">
          No rules yet. Create one to automate routine changes.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto [&_th:nth-child(2)]:min-w-[240px] [&_td:nth-child(2)]:min-w-[240px]">
            <table className="automation-table w-full text-left text-xs sm:text-sm">
              <thead className="bg-surface-2 border-b border-border text-text-subtle font-semibold uppercase text-[10px]">
                <tr>
                  <th scope="col" className="p-3">
                    Rule
                  </th>
                  <th scope="col" className="p-3">
                    When
                  </th>
                  <th scope="col" className="p-3">
                    Status
                  </th>
                  <th scope="col" className="p-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {(rules.data ?? []).map((r) => (
                  <React.Fragment key={r.id}>
                    <tr className="hover:bg-surface-2 transition-colors">
                      <td className="p-3 font-semibold text-text-main">{r.name}</td>
                      <td className="p-3 text-text-subtle">
                        {r.trigger_event === "scheduled"
                          ? `Every ${r.schedule ?? "day"}`
                          : r.trigger_event.replace(/_/g, " ")}
                        {r.trigger_event === "scheduled" && r.next_run_at && (
                          <span className="text-text-subtle text-[11px] font-mono">
                            {" "}
                            · next {new Date(r.next_run_at).toLocaleString()}
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <label className="inline-flex items-center gap-1.5 text-xs text-text-main cursor-pointer font-medium">
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={() => void toggle(r)}
                            className="rounded text-accent focus:ring-accent"
                          />{" "}
                          {r.enabled ? "On" : "Off"}
                        </label>
                      </td>
                      <td className="p-3 text-right space-x-1.5 flex flex-wrap gap-2 items-center">
                        <button
                          className="px-2.5 py-1 bg-surface-2 hover:bg-surface-3 border border-border rounded-lg text-xs font-medium text-text-main inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] hover:text-text-main"
                          aria-expanded={openRuns === r.id}
                          onClick={() => setOpenRuns(openRuns === r.id ? null : r.id)}
                        >
                          Run log
                        </button>
                        <button
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-surface-2 hover:bg-danger/10 hover:text-danger border border-border rounded-lg text-xs font-medium text-text-main transition-colors justify-center whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px]"
                          onClick={() => void remove(r)}
                          aria-label={`Delete rule ${r.name}`}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </td>
                    </tr>
                    {openRuns === r.id && (
                      <tr className="bg-surface-2/60">
                        <td colSpan={4} className="p-4">
                          {runs.isLoading ? (
                            <span className="text-xs text-text-subtle">Loading…</span>
                          ) : (runs.data ?? []).length === 0 ? (
                            <span className="text-xs text-text-subtle">This rule has not run yet.</span>
                          ) : (
                            <ul className="space-y-1 font-mono text-xs text-text-main">
                              {(runs.data ?? []).map((run) => (
                                <li key={run.id} className="p-2 bg-surface rounded-lg border border-border">
                                  {new Date(run.at).toLocaleString()} ·{" "}
                                  {run.issue_number
                                    ? `#${run.issue_number} ${run.issue_title ?? ""}`
                                    : "issue removed"}{" "}
                                  · {run.result}
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
        </Card>
      )}
    </section>
  );
}
