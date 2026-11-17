import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../../lib/api";
import { Plus, X, AlertCircle } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { useTeams } from "../agile/agile-shared";
import { defaultTypeKey, typeName } from "../../lib/issue-types";
import { PageTemplates } from "./PageTemplates";

export function CreateModal() {
  const { error, busy, modal, setModal, draft, setDraft, create, session, issueTypes } = useWorkspace();
  const teams = useTeams(session.token, modal === "issue");
  const { selected, project, setSelectedIssue } = useWorkspace();
  const titleText = draft.title.trim();

  const similar = useQuery({
    queryKey: ["similar", selected, titleText],
    queryFn: () =>
      request<{ id: string; number: number; title: string; status: string }[]>(
        session.token,
        `/projects/${selected}/similar?title=${encodeURIComponent(titleText)}`,
      ),
    enabled: modal === "issue" && !!selected && titleText.length >= 4,
    staleTime: 10_000,
  });

  useEffect(() => {
    const keys = issueTypes.map((t) => t.key);
    if (modal === "issue" && keys.length && !keys.includes(draft.kind)) {
      setDraft({ ...draft, kind: defaultTypeKey(issueTypes) });
    }
  }, [modal, draft, issueTypes, setDraft]);

  if (!modal) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-overlay backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fadeIn"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setModal(null);
      }}
    >
      <form
        className="relative w-full max-w-lg bg-surface rounded-2xl shadow-2xl border border-border overflow-hidden my-auto flex flex-col max-h-[90vh] text-text-main"
        onSubmit={create}
      >
        {/* Header */}
        <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <div className="text-[11px] font-extrabold tracking-wider uppercase text-accent mb-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              CREATE
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-text-main tracking-tight font-display m-0">
              {modal === "project" ? "New project" : modal === "issue" ? "New issue" : "New knowledge page"}
            </h2>
          </div>
          <button
            type="button"
            className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-3 transition-colors cursor-pointer"
            onClick={() => setModal(null)}
          >
            <X size={19} />
          </button>
        </div>

        {/* Body Form */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1 text-xs sm:text-sm">
          {modal === "project" ? (
            <>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                  Project name
                </label>
                <input
                  required
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Product launch"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-bg text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent-ring focus:border-accent text-sm transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                  Project key
                </label>
                <input
                  required
                  maxLength={10}
                  minLength={2}
                  value={draft.key}
                  onChange={(e) =>
                    setDraft({ ...draft, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })
                  }
                  placeholder="PLAT"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-bg text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent-ring focus:border-accent text-sm uppercase font-mono font-bold tracking-wider transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="What is this project for?"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-bg text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent-ring focus:border-accent text-sm transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                  Starting template
                </label>
                <select
                  value={draft.template}
                  onChange={(e) => setDraft({ ...draft, template: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-bg text-text-main text-sm focus:outline-hidden focus:ring-2 focus:ring-accent-ring focus:border-accent transition-colors"
                >
                  <option value="software">Software (To do, In progress, In review, Done)</option>
                  <option value="kanban">Kanban (To do, In progress, Done)</option>
                  <option value="bugs">Bug tracking (New, Triage, Fixing, Verified, Closed)</option>
                  <option value="service">Service requests (Open, Waiting, Resolved)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                  Who can see it
                </label>
                <select
                  value={draft.visibility}
                  onChange={(e) => setDraft({ ...draft, visibility: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-bg text-text-main text-sm focus:outline-hidden focus:ring-2 focus:ring-accent-ring focus:border-accent transition-colors"
                >
                  <option value="workspace">Everyone in the workspace</option>
                  <option value="private">Private (only people I add)</option>
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                  Title
                </label>
                <input
                  required
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder={modal === "issue" ? "What needs to be done?" : "Page title"}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-bg text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent-ring focus:border-accent text-sm transition-colors"
                />
              </div>

              {modal === "issue" && (similar.data ?? []).length > 0 && (
                <div className="p-3 rounded-xl bg-warning-soft border border-warning-border text-xs">
                  <b className="text-warning-text flex items-center gap-1.5 mb-1.5">
                    <AlertCircle size={14} /> Possibly the same work:
                  </b>
                  <ul className="space-y-1 text-text-main pl-2">
                    {(similar.data ?? []).map((s) => (
                      <li key={s.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          className="font-mono font-bold text-accent hover:underline cursor-pointer"
                          onClick={() => {
                            setModal(null);
                            setSelectedIssue(s.id);
                          }}
                        >
                          {project?.key}-{s.number}
                        </button>
                        <span className="truncate">{s.title}</span>
                        <span className="text-text-muted">· {s.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {modal === "issue" && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                      Type
                    </label>
                    <select
                      value={draft.kind}
                      onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-main text-xs font-medium focus:outline-hidden"
                    >
                      {issueTypes.map((t) => (
                        <option key={t.key} value={t.key}>
                          {typeName(issueTypes, t.key)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                      Priority
                    </label>
                    <select
                      value={draft.priority}
                      onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-main text-xs font-medium capitalize focus:outline-hidden"
                    >
                      {["low", "medium", "high", "urgent"].map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                      Team
                    </label>
                    <select
                      value={draft.teamId}
                      onChange={(e) => setDraft({ ...draft, teamId: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-main text-xs font-medium focus:outline-hidden"
                    >
                      <option value="">No team (product backlog)</option>
                      {(teams.data ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {modal === "page" && (
                <PageTemplates
                  token={session.token}
                  projectId={selected}
                  content={draft.content}
                  onApply={(body) => setDraft({ ...draft, content: body })}
                />
              )}

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-main mb-1.5">
                  {modal === "page" ? "Content" : "Description"}
                </label>
                <textarea
                  rows={5}
                  value={modal === "page" ? draft.content : draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, [modal === "page" ? "content" : "description"]: e.target.value })
                  }
                  placeholder="Add details…"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-bg text-text-main placeholder-text-muted focus:outline-hidden focus:ring-2 focus:ring-accent-ring focus:border-accent text-sm transition-colors"
                />
              </div>
            </>
          )}

          {error && (
            <div className="error p-3 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs font-medium">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 sm:px-6 sm:py-4 bg-surface-2 border-t border-border flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold border border-border bg-surface-2 text-text-main hover:bg-surface-3 transition-colors cursor-pointer"
            onClick={() => setModal(null)}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold text-white bg-accent hover:bg-accent-strong active:bg-accent-strong shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            disabled={busy}
          >
            <span>{busy ? "Creating…" : "Create " + modal}</span>
            <Plus size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
