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
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

const RELEASE_LABEL: Record<string, string> = {
  planned: "Planned",
  released: "Released",
  cancelled: "Cancelled",
};

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
    <section className="planning releases space-y-6" aria-labelledby="releases-title">
      <div className="planning-head">
        <PageHeader title="Releases" subtitle="What ships, when scope froze, and what changed after that." />
        <h2 id="releases-title" className="sr-only">
          Releases
        </h2>
      </div>

      <div className="release-grid grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column: Release list and creation */}
        <aside className="release-list lg:col-span-4 space-y-4" aria-label="Releases">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-text-subtle">
                New Release
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="release-create space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!name.trim() || !selected) return;
                  run(async () => {
                    const created = await send<Release>(
                      `/projects/${selected}/releases`,
                      session.token,
                      "POST",
                      {
                        name: name.trim(),
                        description,
                      },
                    );
                    setChosen(created.id);
                    setName("");
                    setDescription("");
                  }, "Release created");
                }}
              >
                <label className="block space-y-1 text-[11px]">
                  <span className="text-xs font-semibold text-text-subtle">Release name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={250}
                    placeholder="e.g. v2.4.0 Sprint Alpha"
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label className="block space-y-1 text-[11px]">
                  <span className="text-xs font-semibold text-text-subtle">What is included</span>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={5000}
                    placeholder="Key features, bug fixes, migration notes"
                    className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <button
                  className="w-full py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs sm:text-sm font-medium transition-colors flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5"
                  disabled={!name.trim()}
                >
                  <Plus size={15} /> Create release
                </button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-text-subtle">
                Releases ({all.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <ul className="space-y-1">
                {all.map((r) => {
                  const isSelected = r.id === releaseId;
                  return (
                    <li key={r.id}>
                      <button
                        className={`release-item w-full flex items-center justify-between p-2.5 rounded-xl text-xs sm:text-sm transition-colors text-left ${
                          isSelected
                            ? "active bg-accent/10 border border-accent/30 text-accent font-semibold"
                            : "hover:bg-surface-2 text-text-main"
                        }`}
                        aria-current={isSelected ? "true" : undefined}
                        onClick={() => {
                          setChosen(r.id);
                          setNotes(null);
                          setConfirming(null);
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Flag
                            size={14}
                            className={isSelected ? "text-accent" : "text-text-subtle"}
                            aria-hidden
                          />
                          <span className="truncate">{r.name}</span>
                        </div>
                        <span
                          className={`shrink-0 ml-2 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full capitalize whitespace-nowrap ${
                            r.status === "released"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                              : r.status === "cancelled"
                                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                                : "bg-surface-2 text-text-muted border border-border"
                          }`}
                        >
                          {RELEASE_LABEL[r.status] ?? r.status}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!releases.isLoading && all.length === 0 && (
                <p className="text-center py-6 text-xs text-text-subtle">No releases yet.</p>
              )}
            </CardContent>
          </Card>
        </aside>

        {/* Right column: Release detail */}
        <main className="lg:col-span-8">
          {current ? (
            <Card className="release-detail space-y-6 p-4 sm:p-6">
              <header className="release-head flex flex-wrap items-center gap-3 pb-4 border-b border-border">
                <div className="flex-1 min-w-[200px]">
                  <h3 className="text-xl sm:text-2xl font-extrabold text-text-main font-display">
                    {current.name}
                  </h3>
                  {current.description && (
                    <p className="text-xs sm:text-sm text-text-subtle mt-1">{current.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-lg capitalize whitespace-nowrap ${
                      current.status === "released"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        : current.status === "cancelled"
                          ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                          : "bg-surface-2 text-text-muted border border-border"
                    }`}
                  >
                    {RELEASE_LABEL[current.status] ?? current.status}
                  </span>
                  {current.frozen_at && (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-lg capitalize whitespace-nowrap"
                      title={`Scope frozen ${shortDay(current.frozen_at)}`}
                    >
                      <Lock size={12} aria-hidden /> Scope frozen
                    </span>
                  )}
                  {current.target_at && (
                    <span className="text-xs text-text-subtle">Target: {shortDay(current.target_at)}</span>
                  )}
                  {current.released_at && (
                    <span className="text-xs text-text-subtle">
                      Released: {shortDay(current.released_at)}
                    </span>
                  )}
                </div>
              </header>

              {totals && (
                <div
                  className="release-progress bg-surface-2 p-4 rounded-xl border border-border space-y-2"
                  aria-label="Release progress"
                >
                  <div className="progress-track w-full h-2.5 bg-bg rounded-full overflow-hidden border border-border/60">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{
                        width: `${totals.scope_points ? Math.round((totals.done_points / totals.scope_points) * 100) : totals.scope_count ? Math.round((totals.done_count / totals.scope_count) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-text-subtle block font-medium">
                    {totals.done_count}/{totals.scope_count} issues done · {totals.done_points}/
                    {totals.scope_points} pts · {totals.added_after_freeze} added after freeze ·{" "}
                    {totals.removed_count} removed in total
                  </span>
                </div>
              )}

              {/* Action buttons */}
              <div className="release-actions flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                <button
                  className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main"
                  onClick={() =>
                    downloadCsv(
                      `/releases/${releaseId}/export.csv`,
                      session.token,
                      `${current.name}-scope.csv`,
                    ).catch((e) => setError(errorMessage(e)))
                  }
                >
                  Export scope CSV
                </button>
                {open && !current.frozen_at && (
                  <button
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main transition-colors justify-center whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main"
                    onClick={() =>
                      run(
                        () => send(`/releases/${releaseId}`, session.token, "PATCH", { freeze: true }),
                        "Scope frozen",
                      )
                    }
                  >
                    <Lock size={14} /> Freeze scope
                  </button>
                )}
                {open && confirming !== "release" && (
                  <button
                    className="px-3.5 py-1.5 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs font-medium transition-colors shadow-sm inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)]"
                    onClick={() => setConfirming("release")}
                  >
                    Release…
                  </button>
                )}
                {open && confirming !== "cancel" && (
                  <button
                    className="px-3 py-1.5 bg-surface-2 hover:bg-danger/10 hover:text-danger border border-border rounded-xl text-xs font-medium text-text-main transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)]"
                    onClick={() => setConfirming("cancel")}
                  >
                    Cancel release
                  </button>
                )}

                {open && confirming === "release" && (
                  <div
                    className="release-confirm flex flex-wrap items-center gap-2 p-3 bg-surface-2 rounded-xl border border-accent/30 w-full"
                    role="group"
                    aria-label="Confirm release"
                  >
                    <label className="flex items-center gap-2 text-xs text-text-subtle">
                      <span>Unfinished work goes to:</span>
                      <select
                        value={moveTo}
                        onChange={(e) => setMoveTo(e.target.value)}
                        className="px-2.5 py-1 bg-surface border border-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        <option value="backlog">Backlog (leaves this release)</option>
                        {plannedOthers.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="inline-flex items-center gap-1 px-3 py-1 bg-accent hover:bg-accent-strong text-white rounded-lg text-xs font-medium justify-center whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] shadow-[var(--shadow-sm)]"
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
                    <button
                      className="px-2.5 py-1 bg-surface hover:bg-surface-3 border border-border rounded-lg text-xs inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
                      onClick={() => setConfirming(null)}
                    >
                      Back
                    </button>
                  </div>
                )}

                {open && confirming === "cancel" && (
                  <div
                    className="release-confirm flex flex-wrap items-center gap-2 p-3 bg-danger/10 rounded-xl border border-danger/30 w-full"
                    role="group"
                    aria-label="Confirm cancel"
                  >
                    <span className="text-xs text-danger font-medium">
                      Cancel this release? Its scope history is kept.
                    </span>
                    <button
                      className="inline-flex items-center gap-1 px-3 py-1 bg-danger hover:bg-danger/90 text-white rounded-lg text-xs font-medium cursor-pointer border border-danger-border"
                      onClick={() => {
                        setConfirming(null);
                        run(
                          () =>
                            send(`/releases/${releaseId}`, session.token, "PATCH", { status: "cancelled" }),
                          "Release cancelled",
                        );
                      }}
                    >
                      <X size={14} /> Cancel release
                    </button>
                    <button
                      className="px-2.5 py-1 bg-surface hover:bg-surface-3 border border-border rounded-lg text-xs inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
                      onClick={() => setConfirming(null)}
                    >
                      Back
                    </button>
                  </div>
                )}

                <button
                  className="ml-auto px-3 py-1.5 bg-surface-2 hover:bg-surface-3 border border-border rounded-xl text-xs font-medium text-text-main transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main"
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
                <div className="release-notes bg-surface-2 p-4 rounded-xl border border-border space-y-3">
                  <div className="release-notes-head flex items-center justify-between">
                    <h4 className="text-sm font-bold text-text-main">Release notes</h4>
                    <button
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-surface border border-border rounded-lg text-xs font-medium text-text-main hover:bg-surface-3 justify-center whitespace-nowrap cursor-pointer transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] hover:text-text-main"
                      onClick={() =>
                        navigator.clipboard?.writeText(notes.markdown).then(() => toast("Copied"))
                      }
                    >
                      <Copy size={13} /> Copy
                    </button>
                  </div>
                  <pre className="p-3 bg-bg border border-border rounded-xl text-xs font-mono whitespace-pre-wrap text-text-main max-h-60 overflow-y-auto">
                    {notes.markdown}
                  </pre>
                </div>
              )}

              {open && (
                <form
                  className="release-add flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 bg-surface-2 rounded-xl border border-border"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!addIssue) return;
                    run(async () => {
                      await send(`/releases/${releaseId}/issues`, session.token, "POST", {
                        issue_ids: [addIssue],
                      });
                      setAddIssue("");
                    }, "Added to release");
                  }}
                >
                  <label className="flex-1 flex flex-col sm:flex-row items-start sm:items-center gap-2 text-xs text-text-subtle">
                    <span className="font-semibold text-text-main whitespace-nowrap">Add issue:</span>
                    <select
                      value={addIssue}
                      onChange={(e) => setAddIssue(e.target.value)}
                      className="w-full px-3 py-1.5 bg-surface border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent"
                    >
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
                  <button
                    className="shrink-0 px-3.5 py-1.5 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] border border-border-strong hover:text-text-main"
                    disabled={!addIssue}
                  >
                    Add to scope
                  </button>
                </form>
              )}

              {/* Scope */}
              <div className="space-y-3 pt-2">
                <h4 className="text-sm font-bold uppercase tracking-wider text-text-subtle mt-3 mb-1.5">
                  Scope
                </h4>
                <ul
                  className="release-scope divide-y divide-border/60 border border-border rounded-xl bg-surface overflow-hidden"
                  aria-label="Release scope"
                >
                  {(scope.data ?? []).map((s) => (
                    <li
                      key={s.id}
                      className={`flex items-center gap-3 p-3 text-xs sm:text-sm hover:bg-surface-2 transition-colors ${s.done ? "done opacity-75" : ""}`}
                    >
                      <button
                        className="issue-number-button shrink-0 font-bold text-accent hover:underline font-mono text-xs px-1.5 py-0.5 rounded bg-accent/10"
                        onClick={() => setSelectedIssue(s.id)}
                      >
                        {key}-{s.number}
                      </button>
                      <span className="release-scope-title flex-1 font-medium text-text-main truncate">
                        {s.title}
                      </span>
                      {s.added_after_freeze && (
                        <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-full capitalize whitespace-nowrap">
                          After freeze
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-text-subtle font-medium">
                        {s.done ? "Done" : s.status}
                      </span>
                      {open && (
                        <button
                          className="icon-ghost shrink-0 p-1 text-text-subtle hover:text-danger rounded-lg transition-colors"
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
                    <li className="p-4 text-center text-xs text-text-subtle">No issues in scope yet.</li>
                  )}
                </ul>
              </div>

              {/* History */}
              <div className="space-y-3 pt-2">
                <h4 className="text-sm font-bold uppercase tracking-wider text-text-subtle mt-3 mb-1.5">
                  History
                </h4>
                <ol className="release-history space-y-2 text-xs" aria-label="Scope history">
                  {(history.data ?? []).map((h, n) => (
                    <li
                      key={`${h.issue_id}-${h.action}-${n}`}
                      className="flex items-center gap-2 p-2 bg-surface-2 rounded-lg border border-border/60"
                    >
                      <span className="font-mono text-text-subtle text-[11px]">{shortDay(h.at)}</span>{" "}
                      <span className="text-text-main">
                        {h.action === "added" ? "Added" : "Removed"}{" "}
                        <strong>
                          {key}-{h.number}
                        </strong>{" "}
                        {h.title}
                      </span>
                      {h.after_freeze && (
                        <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded capitalize whitespace-nowrap">
                          After freeze
                        </span>
                      )}
                    </li>
                  ))}
                  {!history.isLoading && (history.data ?? []).length === 0 && (
                    <li className="text-text-subtle py-2 text-[11px]">No changes recorded yet.</li>
                  )}
                </ol>
              </div>
            </Card>
          ) : (
            <Card className="release-detail p-12 text-center text-sm text-text-subtle">
              Create a release, or pick one to see its scope.
            </Card>
          )}
        </main>
      </div>
    </section>
  );
}
