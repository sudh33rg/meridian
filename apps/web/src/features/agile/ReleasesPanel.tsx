import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Flag, Lock, Plus, X } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { downloadCsv } from "../../lib/download";
import type { Issue } from "../../lib/types";
import { useToast } from "../shared/Toast";
import {
  type Release,
  type ReleaseDetail,
  type ReleaseNotes,
  type ReleaseScopeItem,
  type ScopeEvent,
  invalidatePlanning,
  shortDay,
} from "./agile-shared";

const RELEASE_LABEL: Record<string, string> = { planned: "Planned", released: "Released", cancelled: "Cancelled" };

/** Releases: scope, scope freeze, history of changes, the release action and generated notes. */
export function ReleasesPanel() {
  const { session, selected, project, tab, setError, setSelectedIssue } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [chosen, setChosen] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [addIssue, setAddIssue] = useState("");
  const [confirming, setConfirming] = useState<null | "release" | "cancel">(null);
  const [moveTo, setMoveTo] = useState("backlog");
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  const active = tab === "releases" && !!selected;
  const releases = useQuery({
    queryKey: ["releases", selected],
    queryFn: () => request<Release[]>(session.token, `/projects/${selected}/releases`),
    enabled: active,
  });
  const releaseId = chosen || releases.data?.[0]?.id || "";
  const detail = useQuery({
    queryKey: ["release", releaseId],
    queryFn: () => request<ReleaseDetail>(session.token, `/releases/${releaseId}`),
    enabled: active && !!releaseId,
  });
  const scope = useQuery({
    queryKey: ["release", releaseId, "scope"],
    queryFn: () => request<ReleaseScopeItem[]>(session.token, `/releases/${releaseId}/issues`),
    enabled: active && !!releaseId,
  });
  const history = useQuery({
    queryKey: ["release", releaseId, "history"],
    queryFn: () => request<ScopeEvent[]>(session.token, `/releases/${releaseId}/history`),
    enabled: active && !!releaseId,
  });
  const candidates = useQuery({
    queryKey: ["issues", selected, "for-release"],
    queryFn: () => request<Issue[]>(session.token, `/projects/${selected}/issues?limit=500`),
    enabled: active,
  });
  if (!active) return null;

  const all = releases.data ?? [];
  const current = detail.data?.release ?? all.find((r) => r.id === releaseId);
  const totals = detail.data?.totals;
  const inScope = new Set((scope.data ?? []).map((s) => s.id));
  const key = project?.key ?? "";
  const open = current?.status === "planned";
  const plannedOthers = all.filter((r) => r.id !== releaseId && r.status === "planned");

  const run = async (job: () => Promise<unknown>, message?: string) => {
    try {
      await job();
      if (message) toast(message);
      await invalidatePlanning(qc, selected);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="planning releases" aria-labelledby="releases-title">
      <div className="planning-head">
        <div>
          <h2 id="releases-title">Releases</h2>
          <p className="muted small">What ships, when scope froze, and what changed after that.</p>
        </div>
      </div>
      <div className="release-grid">
        <aside className="release-list" aria-label="Releases">
          <form
            className="release-create"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || !selected) return;
              run(
                async () => {
                  const created = await send<Release>(`/projects/${selected}/releases`, session.token, "POST", {
                    name: name.trim(),
                    description,
                  });
                  setChosen(created.id);
                  setName("");
                  setDescription("");
                },
                "Release created",
              );
            }}
          >
            <label className="small">
              Release name
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={250} />
            </label>
            <label className="small">
              What is included
              <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
            </label>
            <button className="primary" disabled={!name.trim()}>
              <Plus size={15} /> Create release
            </button>
          </form>
          <ul>
            {all.map((r) => (
              <li key={r.id}>
                <button
                  className={"release-item" + (r.id === releaseId ? " active" : "")}
                  aria-current={r.id === releaseId ? "true" : undefined}
                  onClick={() => {
                    setChosen(r.id);
                    setNotes(null);
                    setConfirming(null);
                  }}
                >
                  <Flag size={14} aria-hidden /> <span>{r.name}</span>
                  <span className="chip">{RELEASE_LABEL[r.status] ?? r.status}</span>
                </button>
              </li>
            ))}
          </ul>
          {!releases.isLoading && all.length === 0 && <p className="muted small">No releases yet.</p>}
        </aside>
        {current ? (
          <div className="release-detail">
            <header className="release-head">
              <h3>{current.name}</h3>
              <span className="chip">{RELEASE_LABEL[current.status] ?? current.status}</span>
              {current.frozen_at && (
                <span className="chip" title={`Scope frozen ${shortDay(current.frozen_at)}`}>
                  <Lock size={12} aria-hidden /> Scope frozen
                </span>
              )}
              {current.target_at && <span className="small muted">Target {shortDay(current.target_at)}</span>}
              {current.released_at && <span className="small muted">Released {shortDay(current.released_at)}</span>}
            </header>
            {current.description && <p className="muted">{current.description}</p>}
            {totals && (
              <div className="release-progress" aria-label="Release progress">
                <div className="progress-track">
                  <div
                    style={{
                      width: `${totals.scope_points ? Math.round((totals.done_points / totals.scope_points) * 100) : totals.scope_count ? Math.round((totals.done_count / totals.scope_count) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="small">
                  {totals.done_count}/{totals.scope_count} issues done · {totals.done_points}/{totals.scope_points} pts ·{" "}
                  {totals.added_after_freeze} added after freeze · {totals.removed_count} removed in total
                </span>
              </div>
            )}
            <div className="release-actions">
              <button
                className="secondary"
                onClick={() =>
                  downloadCsv(`/releases/${releaseId}/export.csv`, session.token, `${current.name}-scope.csv`).catch((e) =>
                    setError(errorMessage(e)),
                  )
                }
              >
                Export scope CSV
              </button>
              {open && !current.frozen_at && (
                <button className="secondary" onClick={() => run(() => send(`/releases/${releaseId}`, session.token, "PATCH", { freeze: true }), "Scope frozen")}>
                  <Lock size={14} /> Freeze scope
                </button>
              )}
              {open && confirming !== "release" && (
                <button className="primary" onClick={() => setConfirming("release")}>
                  Release…
                </button>
              )}
              {open && confirming !== "cancel" && (
                <button className="secondary" onClick={() => setConfirming("cancel")}>
                  Cancel release
                </button>
              )}
              {open && confirming === "release" && (
                <div className="release-confirm" role="group" aria-label="Confirm release">
                  <label className="small">
                    Unfinished work goes to
                    <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                      <option value="backlog">Backlog (leaves this release)</option>
                      {plannedOthers.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary"
                    onClick={() => {
                      setConfirming(null);
                      run(
                        () =>
                          send(`/releases/${releaseId}`, session.token, "PATCH", {
                            status: "released",
                            move_unfinished_to: moveTo,
                          }),
                        `${current.name} released`,
                      );
                    }}
                  >
                    <Check size={14} /> Confirm release
                  </button>
                  <button className="secondary" onClick={() => setConfirming(null)}>
                    Back
                  </button>
                </div>
              )}
              {open && confirming === "cancel" && (
                <div className="release-confirm" role="group" aria-label="Confirm cancel">
                  <span className="small">Cancel this release? Its scope history is kept.</span>
                  <button
                    className="danger"
                    onClick={() => {
                      setConfirming(null);
                      run(() => send(`/releases/${releaseId}`, session.token, "PATCH", { status: "cancelled" }), "Release cancelled");
                    }}
                  >
                    <X size={14} /> Cancel release
                  </button>
                  <button className="secondary" onClick={() => setConfirming(null)}>
                    Back
                  </button>
                </div>
              )}
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    setNotes(await request<ReleaseNotes>(session.token, `/releases/${releaseId}/notes`));
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                Release notes
              </button>
            </div>
            {notes && (
              <div className="release-notes">
                <div className="release-notes-head">
                  <h4>Release notes</h4>
                  <button
                    className="secondary small-btn"
                    onClick={() => navigator.clipboard?.writeText(notes.markdown).then(() => toast("Copied"))}
                  >
                    <Copy size={14} /> Copy
                  </button>
                </div>
                <pre>{notes.markdown}</pre>
              </div>
            )}
            {open && (
              <form
                className="release-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!addIssue) return;
                  run(async () => {
                    await send(`/releases/${releaseId}/issues`, session.token, "POST", { issue_ids: [addIssue] });
                    setAddIssue("");
                  }, "Added to release");
                }}
              >
                <label className="small">
                  Add an issue to this release
                  <select value={addIssue} onChange={(e) => setAddIssue(e.target.value)}>
                    <option value="">Choose an issue…</option>
                    {(candidates.data ?? [])
                      .filter((i) => !inScope.has(i.id))
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {key}-{i.number} {i.title}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="secondary" disabled={!addIssue}>
                  Add to scope
                </button>
              </form>
            )}
            <h4 className="section-title">Scope</h4>
            <ul className="release-scope" aria-label="Release scope">
              {(scope.data ?? []).map((s) => (
                <li key={s.id} className={s.done ? "done" : ""}>
                  <button className="issue-number-button" onClick={() => setSelectedIssue(s.id)}>
                    {key}-{s.number}
                  </button>
                  <span className="release-scope-title">{s.title}</span>
                  {s.added_after_freeze && <span className="chip warn">After freeze</span>}
                  <span className="small muted">{s.done ? "Done" : s.status}</span>
                  {open && (
                    <button
                      className="icon-ghost"
                      aria-label={`Remove ${key}-${s.number} from scope`}
                      onClick={() =>
                        run(
                          () => send(`/releases/${releaseId}/issues/${s.id}`, session.token, "DELETE"),
                          "Removed from scope",
                        )
                      }
                    >
                      <X size={14} />
                    </button>
                  )}
                </li>
              ))}
              {!scope.isLoading && (scope.data ?? []).length === 0 && (
                <li className="muted small">No issues in scope yet.</li>
              )}
            </ul>
            <h4 className="section-title">History</h4>
            <ol className="release-history" aria-label="Scope history">
              {(history.data ?? []).map((h, n) => (
                <li key={`${h.issue_id}-${h.action}-${n}`}>
                  <span className="small muted">{shortDay(h.at)}</span> {h.action === "added" ? "Added" : "Removed"}{" "}
                  {key}-{h.number} {h.title}
                  {h.after_freeze && <span className="chip warn">After freeze</span>}
                </li>
              ))}
              {!history.isLoading && (history.data ?? []).length === 0 && (
                <li className="muted small">No changes recorded yet.</li>
              )}
            </ol>
          </div>
        ) : (
          <div className="release-detail muted">Create a release, or pick one to see its scope.</div>
        )}
      </div>
    </section>
  );
}
