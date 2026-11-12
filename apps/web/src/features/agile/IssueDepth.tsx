import { formatDateTime } from "../../lib/datetime";
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, ListChecks, MoveRight, Plus, ThumbsUp, Trash2 } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { invalidatePlanning } from "./agile-shared";

type Component = { id: string; name: string; issue_count: number; default_assignee_id?: string | null };
type Estimates = {
  original_minutes: number | null;
  remaining_minutes: number | null;
  logged_minutes: number;
};
type Worklog = {
  id: string;
  author_id: string;
  author_name: string;
  minutes: number;
  started_on: string;
  comment: string;
};
type Person = { user_id: string; display_name: string };
type Votes = { count: number; voted: boolean };
type Checklist = { id: string; text: string; done: boolean; position: number };
type Child = {
  id: string;
  number: number;
  title: string;
  status: string;
  done: boolean;
  story_points?: number | null;
};
type Rollup = {
  children: number;
  children_done: number;
  points_total: number;
  points_done: number;
  original_minutes_total: number;
  remaining_minutes_total: number;
  logged_minutes_total: number;
};
type Issue = { id: string; number: number; title: string; project_id: string };

/** Minutes shown as `2h 30m`. */
export function formatMinutes(total: number | null | undefined) {
  if (!total) return "0m";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}

/** Parses `2h 30m`, `90m`, `1.5h` or a plain number of minutes. Returns null for empty input. */
export function parseMinutes(raw: string): number | null | "invalid" {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const plain = Number(s);
  if (Number.isFinite(plain) && /^[0-9.]+$/.test(s)) return Math.round(plain);
  let total = 0;
  const parts = [...s.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*([hm])/g)];
  if (parts.length === 0) return "invalid";
  for (const [, n, unit] of parts) total += unit === "h" ? Number(n) * 60 : Number(n);
  return Math.round(total);
}

/** Planning details for one issue inside the drawer: components, estimates and worklogs, watching
 * and votes, checklist, subtasks with roll-up, and clone or move. */
export function IssueDepth({
  issue,
  archived,
  onChanged,
}: {
  issue: Issue;
  archived: boolean;
  onChanged: () => void;
}) {
  const { session, me, setError, setSelectedIssue, projects } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const token = session.token;
  const id = issue.id;
  const projectId = issue.project_id;
  const projectKey = projectKeyOf(projects, projectId);
  const [minutes, setMinutes] = useState("");
  const [workDay, setWorkDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [workNote, setWorkNote] = useState("");
  const [estOriginal, setEstOriginal] = useState<string | null>(null);
  const [estRemaining, setEstRemaining] = useState<string | null>(null);
  const [checkText, setCheckText] = useState("");
  const [subtask, setSubtask] = useState("");
  const [moveTo, setMoveTo] = useState("");

  const components = useQuery({
    queryKey: ["components", projectId],
    queryFn: () => request<Component[]>(token, `/projects/${projectId}/components`),
  });
  const attached = useQuery({
    queryKey: ["issue-components", id],
    queryFn: () => request<Component[]>(token, `/issues/${id}/components`),
  });
  const estimates = useQuery({
    queryKey: ["estimates", id],
    queryFn: () => request<Estimates>(token, `/issues/${id}/estimates`),
  });
  const worklogs = useQuery({
    queryKey: ["worklogs", id],
    queryFn: () => request<Worklog[]>(token, `/issues/${id}/worklogs`),
  });
  const watchers = useQuery({
    queryKey: ["watchers", id],
    queryFn: () => request<Person[]>(token, `/issues/${id}/watchers`),
  });
  const votes = useQuery({
    queryKey: ["votes", id],
    queryFn: () => request<Votes>(token, `/issues/${id}/votes`),
  });
  const checklist = useQuery({
    queryKey: ["checklist", id],
    queryFn: () => request<Checklist[]>(token, `/issues/${id}/checklist`),
  });
  const children = useQuery({
    queryKey: ["children", id],
    queryFn: () => request<Child[]>(token, `/issues/${id}/children`),
  });
  const rollup = useQuery({
    queryKey: ["rollup", id],
    queryFn: () => request<Rollup>(token, `/issues/${id}/rollup`),
  });

  const refresh = async (message?: string) => {
    await Promise.all(
      [
        "issue-components",
        "estimates",
        "worklogs",
        "watchers",
        "votes",
        "checklist",
        "children",
        "rollup",
      ].map((k) => qc.invalidateQueries({ queryKey: [k, id] })),
    );
    await invalidatePlanning(qc, projectId);
    onChanged();
    if (message) toast(message);
  };
  const act = async (job: () => Promise<unknown>, message?: string) => {
    try {
      await job();
      await refresh(message);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const watching = (watchers.data ?? []).some((w) => w.user_id === me?.user_id);
  const attachedIds = new Set((attached.data ?? []).map((c) => c.id));
  const doneChildren = children.data?.filter((c) => c.done).length ?? 0;
  const otherProjects = projects.filter((p) => p.id !== projectId);

  return (
    <>
      <div className="drawer-section" aria-label="Components and estimates">
        <h3>Components</h3>
        {(components.data ?? []).length === 0 && (
          <p className="muted small">No components in this project yet.</p>
        )}
        <div className="chip-row">
          {(components.data ?? []).map((c) => (
            <label key={c.id} className="chip check-chip">
              <input
                type="checkbox"
                disabled={archived}
                checked={attachedIds.has(c.id)}
                onChange={(e) => {
                  const next = new Set(attachedIds);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  act(
                    () => send(`/issues/${id}/components`, token, "PUT", { component_ids: [...next] }),
                    "Components updated",
                  );
                }}
              />
              {c.name}
            </label>
          ))}
        </div>
        <h3>Estimate and time</h3>
        <div className="form-row">
          <label>
            Original estimate
            <input
              placeholder="e.g. 2h 30m"
              disabled={archived}
              value={estOriginal ?? formatMinutes(estimates.data?.original_minutes ?? null)}
              onChange={(e) => setEstOriginal(e.target.value)}
            />
          </label>
          <label>
            Remaining estimate
            <input
              placeholder="e.g. 1h"
              disabled={archived}
              value={estRemaining ?? formatMinutes(estimates.data?.remaining_minutes ?? null)}
              onChange={(e) => setEstRemaining(e.target.value)}
            />
          </label>
        </div>
        <div className="row-actions">
          <span className="small muted">Logged {formatMinutes(estimates.data?.logged_minutes ?? 0)}</span>
          <button
            className="secondary small-btn"
            disabled={archived || (estOriginal === null && estRemaining === null)}
            onClick={() => {
              const o = parseMinutes(estOriginal ?? formatMinutes(estimates.data?.original_minutes ?? null));
              const r = parseMinutes(
                estRemaining ?? formatMinutes(estimates.data?.remaining_minutes ?? null),
              );
              if (o === "invalid" || r === "invalid") {
                setError("Use a duration such as 2h 30m, 90m or a number of minutes");
                return;
              }
              setEstOriginal(null);
              setEstRemaining(null);
              act(
                () =>
                  send(`/issues/${id}/estimates`, token, "PUT", {
                    original_minutes: o,
                    remaining_minutes: r,
                  }),
                "Estimates saved",
              );
            }}
          >
            Save estimates
          </button>
        </div>
        <h3>Log work</h3>
        <form
          className="row-actions wrap"
          onSubmit={(e) => {
            e.preventDefault();
            const m = parseMinutes(minutes);
            if (m === "invalid" || m === null || m < 1) {
              setError("Log at least one minute, for example 45m or 1h 15m");
              return;
            }
            setMinutes("");
            setWorkNote("");
            act(
              () =>
                send(`/issues/${id}/worklogs`, token, "POST", {
                  minutes: m,
                  started_on: workDay,
                  comment: workNote,
                }),
              "Time logged",
            );
          }}
        >
          <input
            aria-label="Time spent"
            placeholder="1h 15m"
            value={minutes}
            disabled={archived}
            onChange={(e) => setMinutes(e.target.value)}
          />
          <input
            aria-label="Day"
            type="date"
            value={workDay}
            disabled={archived}
            onChange={(e) => setWorkDay(e.target.value)}
          />
          <input
            aria-label="Work note"
            placeholder="What did you do?"
            value={workNote}
            maxLength={2000}
            disabled={archived}
            onChange={(e) => setWorkNote(e.target.value)}
          />
          <button className="secondary small-btn" disabled={archived || !minutes.trim()}>
            Log time
          </button>
        </form>
        <ul className="plain-list" aria-label="Worklogs">
          {(worklogs.data ?? []).slice(0, 8).map((w) => (
            <li key={w.id} className="small">
              <span className="muted">{w.started_on}</span> {w.author_name} logged{" "}
              <b>{formatMinutes(w.minutes)}</b>
              {w.comment ? ` — ${w.comment}` : ""}
              {w.author_id === me?.user_id && !archived && (
                <button
                  className="icon-ghost"
                  aria-label="Delete worklog"
                  onClick={() => act(() => send(`/worklogs/${w.id}`, token, "DELETE"), "Worklog removed")}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="drawer-section" aria-label="Watching and votes">
        <h3>Watching and votes</h3>
        <div className="row-actions">
          <button
            className="secondary small-btn"
            disabled={archived}
            aria-pressed={watching}
            onClick={() =>
              act(
                () =>
                  watching
                    ? send(`/issues/${id}/watchers/${me?.user_id}`, token, "DELETE")
                    : send(`/issues/${id}/watchers`, token, "POST", {}),
                watching ? "Stopped watching" : "Watching this issue",
              )
            }
          >
            {watching ? <EyeOff size={14} /> : <Eye size={14} />} {watching ? "Stop watching" : "Watch"}
          </button>
          <button
            className="secondary small-btn"
            disabled={archived}
            aria-pressed={votes.data?.voted ?? false}
            onClick={() =>
              act(
                () =>
                  votes.data?.voted
                    ? send(`/issues/${id}/vote`, token, "DELETE")
                    : send(`/issues/${id}/vote`, token, "POST"),
                votes.data?.voted ? "Vote removed" : "Voted",
              )
            }
          >
            <ThumbsUp size={14} /> {votes.data?.voted ? "Remove vote" : "Vote"} · {votes.data?.count ?? 0}
          </button>
        </div>
        <p className="small muted">
          Watching: {(watchers.data ?? []).map((w) => w.display_name).join(", ") || "nobody yet"}
        </p>
      </div>

      <div className="drawer-section" aria-label="Checklist">
        <h3>
          <ListChecks size={15} aria-hidden /> Checklist
          {checklist.data?.length
            ? ` · ${checklist.data.filter((c) => c.done).length}/${checklist.data.length}`
            : ""}
        </h3>
        <ul className="plain-list">
          {(checklist.data ?? []).map((c) => (
            <li key={c.id} className="checklist-row">
              <label>
                <input
                  type="checkbox"
                  checked={c.done}
                  disabled={archived}
                  onChange={(e) =>
                    act(() => send(`/checklist/${c.id}`, token, "PATCH", { done: e.target.checked }))
                  }
                />{" "}
                <span className={c.done ? "done-text" : ""}>{c.text}</span>
              </label>
              {!archived && (
                <button
                  className="icon-ghost"
                  aria-label={`Delete checklist item ${c.text}`}
                  onClick={() => act(() => send(`/checklist/${c.id}`, token, "DELETE"))}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <form
          className="row-actions"
          onSubmit={(e) => {
            e.preventDefault();
            const text = checkText.trim();
            if (!text) return;
            setCheckText("");
            act(() => send(`/issues/${id}/checklist`, token, "POST", { text }));
          }}
        >
          <input
            aria-label="New checklist item"
            placeholder="Add an item"
            value={checkText}
            maxLength={500}
            disabled={archived}
            onChange={(e) => setCheckText(e.target.value)}
          />
          <button className="secondary small-btn" disabled={archived || !checkText.trim()}>
            <Plus size={14} /> Add
          </button>
        </form>
      </div>

      <div className="drawer-section" aria-label="Subtasks">
        <h3>
          Subtasks
          {children.data?.length ? ` · ${doneChildren}/${children.data.length} done` : ""}
        </h3>
        {rollup.data && rollup.data.children > 0 && (
          <p className="small muted">
            Points {rollup.data.points_done}/{rollup.data.points_total} · estimate{" "}
            {formatMinutes(rollup.data.original_minutes_total)} · remaining{" "}
            {formatMinutes(rollup.data.remaining_minutes_total)} · logged{" "}
            {formatMinutes(rollup.data.logged_minutes_total)}
          </p>
        )}
        <ul className="plain-list" aria-label="Subtask list">
          {(children.data ?? []).map((c) => (
            <li key={c.id} className="small">
              <button className="issue-number-button" onClick={() => setSelectedIssue(c.id)}>
                #{c.number}
              </button>{" "}
              <span className={c.done ? "done-text" : ""}>{c.title}</span>{" "}
              <span className="muted">{c.status}</span>
            </li>
          ))}
        </ul>
        {!archived && (
          <form
            className="row-actions"
            onSubmit={(e) => {
              e.preventDefault();
              const title = subtask.trim();
              if (!title) return;
              setSubtask("");
              act(() => send(`/issues/${id}/subtasks`, token, "POST", { title }), "Subtask created");
            }}
          >
            <input
              aria-label="New subtask title"
              placeholder="Add a subtask"
              value={subtask}
              maxLength={250}
              onChange={(e) => setSubtask(e.target.value)}
            />
            <button className="secondary small-btn" disabled={!subtask.trim()}>
              <Plus size={14} /> Add subtask
            </button>
          </form>
        )}
      </div>

      <DevLinks token={token} issueId={id} projectKey={projectKey} />
      <IssueHistory token={token} issueId={id} />

      {!archived && (
        <div className="drawer-section" aria-label="Clone and move">
          <h3>Copy or move</h3>
          <div className="row-actions wrap">
            <button
              className="secondary small-btn"
              onClick={async () => {
                try {
                  const copy = await send<{ id: string; number: number }>(
                    `/issues/${id}/clone`,
                    token,
                    "POST",
                    {},
                  );
                  await refresh("Copied");
                  setSelectedIssue(copy.id);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              <Copy size={14} /> Clone
            </button>
            <select aria-label="Move to project" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">Move to project…</option>
              {otherProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="secondary small-btn"
              disabled={!moveTo}
              onClick={() => {
                const target = moveTo;
                setMoveTo("");
                act(async () => {
                  const res = await send<{ dropped_fields: string[] }>(`/issues/${id}/move`, token, "POST", {
                    project_id: target,
                  });
                  if (res.dropped_fields.length) {
                    toast(
                      `Moved. Custom fields not in the target were dropped: ${res.dropped_fields.join(", ")}`,
                    );
                  }
                }, "Moved");
              }}
            >
              <MoveRight size={14} /> Move
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** The issue timeline: status moves and tracked field changes, newest first. */
function IssueHistory({ token, issueId }: { token: string; issueId: string }) {
  const history = useQuery({
    queryKey: ["history", issueId],
    queryFn: () =>
      request<
        {
          kind: string;
          field?: string | null;
          old_value?: string | null;
          new_value?: string | null;
          actor_name: string;
          changed_at: string;
        }[]
      >(token, `/issues/${issueId}/history`),
  });
  const rows = history.data ?? [];
  return (
    <div className="drawer-section" aria-label="History">
      <h3>History · {rows.length}</h3>
      <ul className="plain-list history-list">
        {rows.slice(0, 40).map((h, n) => (
          <li key={`${h.changed_at}-${n}`} className="small">
            <span className="muted">{formatDateTime(h.changed_at)}</span> {h.actor_name}{" "}
            {h.kind === "status" ? (
              <>
                moved status {h.old_value ? <b>{h.old_value}</b> : "from nothing"} → <b>{h.new_value}</b>
              </>
            ) : (
              <>
                changed {h.field?.replaceAll("_", " ")}
                {h.old_value ? (
                  <>
                    {" "}
                    from <b>{trimValue(h.old_value)}</b>
                  </>
                ) : null}
                {h.new_value ? (
                  <>
                    {" "}
                    to <b>{trimValue(h.new_value)}</b>
                  </>
                ) : (
                  " (cleared)"
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {!history.isLoading && rows.length === 0 && <p className="muted small">No changes recorded yet.</p>}
    </div>
  );
}

function trimValue(v: string) {
  return v.length > 60 ? `${v.slice(0, 57)}…` : v;
}

function projectKeyOf(projects: { id: string; key: string }[], id: string) {
  return projects.find((p) => p.id === id)?.key ?? "";
}

/** Commits and pull requests that name this issue, collected from the repository. */
function DevLinks({ token, issueId }: { token: string; issueId: string; projectKey: string }) {
  const links = useQuery({
    queryKey: ["dev-links", issueId],
    queryFn: () =>
      request<
        {
          id: number;
          kind: string;
          reference: string;
          title: string;
          url: string;
          author: string;
          occurred_at: string;
        }[]
      >(token, `/issues/${issueId}/dev-links`),
  });
  const rows = links.data ?? [];
  return (
    <div className="drawer-section" aria-label="Development">
      <h3>Development · {rows.length}</h3>
      <ul className="plain-list">
        {rows.map((l) => (
          <li key={l.id} className="small">
            <span className="chip">
              {l.kind === "pull_request" ? `PR #${l.reference}` : l.reference.slice(0, 8)}
            </span>{" "}
            {l.url ? (
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.title || l.url}
              </a>
            ) : (
              l.title
            )}{" "}
            <span className="muted">{l.author ? `· ${l.author}` : ""}</span>
          </li>
        ))}
      </ul>
      {!links.isLoading && rows.length === 0 && (
        <p className="muted small">
          No commits or pull requests yet. Link a repository from the Integrations page.
        </p>
      )}
    </div>
  );
}
