import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../../lib/api";
import { Plus, X } from "lucide-react";
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
  // A draft kind the project does not define (for example "task" in a project without it) moves to its default.
  useEffect(() => {
    const keys = issueTypes.map((t) => t.key);
    if (modal === "issue" && keys.length && !keys.includes(draft.kind)) {
      setDraft({ ...draft, kind: defaultTypeKey(issueTypes) });
    }
  }, [modal, draft, issueTypes, setDraft]);
  return (
    <>
      {modal && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <form className="modal" onSubmit={create}>
            <div className="modal-head">
              <div>
                <div className="eyebrow blue">CREATE</div>
                <h2>
                  {modal === "project"
                    ? "New project"
                    : modal === "issue"
                      ? "New issue"
                      : "New knowledge page"}
                </h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => setModal(null)}>
                <X size={20} />
              </button>
            </div>
            {modal === "project" ? (
              <>
                <label>
                  Project name
                  <input
                    required
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Product launch"
                  />
                </label>
                <label>
                  Project key
                  <input
                    required
                    maxLength={10}
                    minLength={2}
                    value={draft.key}
                    onChange={(e) =>
                      setDraft({ ...draft, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })
                    }
                    placeholder="PLAT"
                  />
                </label>
                <label>
                  Description
                  <textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="What is this project for?"
                  />
                </label>
                {modal === "project" && (
                  <label>
                    Starting template
                    <select value={draft.template} onChange={(e) => setDraft({ ...draft, template: e.target.value })}>
                      <option value="software">Software (To do, In progress, In review, Done)</option>
                      <option value="kanban">Kanban (To do, In progress, Done)</option>
                      <option value="bugs">Bug tracking (New, Triage, Fixing, Verified, Closed)</option>
                      <option value="service">Service requests (Open, Waiting, Resolved)</option>
                    </select>
                  </label>
                )}
                <label>
                  Who can see it
                  <select
                    value={draft.visibility}
                    onChange={(e) => setDraft({ ...draft, visibility: e.target.value })}
                  >
                    <option value="workspace">Everyone in the workspace</option>
                    <option value="private">Private (only people I add)</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  Title
                  <input
                    required
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder={modal === "issue" ? "What needs to be done?" : "Page title"}
                  />
                </label>
                {modal === "issue" && (similar.data ?? []).length > 0 && (
                  <div className="similar-hint small" role="status">
                    <b>Possibly the same work:</b>
                    <ul>
                      {(similar.data ?? []).map((s) => (
                        <li key={s.id}>
                          <button type="button" className="issue-number-button" onClick={() => { setModal(null); setSelectedIssue(s.id); }}>
                            {project?.key}-{s.number}
                          </button>{" "}
                          {s.title} <span className="muted">· {s.status}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {modal === "issue" && (
                  <div className="form-row">
                    <label>
                      Type
                      <select
                        value={draft.kind}
                        onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                      >
                        {issueTypes.map((t) => (
                          <option key={t.key} value={t.key}>
                            {typeName(issueTypes, t.key)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Priority
                      <select
                        value={draft.priority}
                        onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                      >
                        {["low", "medium", "high", "urgent"].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Team
                      <select value={draft.teamId} onChange={(e) => setDraft({ ...draft, teamId: e.target.value })}>
                        <option value="">No team (product backlog)</option>
                        {(teams.data ?? []).map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
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
                <label>
                  {modal === "page" ? "Content" : "Description"}
                  <textarea
                    rows={5}
                    value={modal === "page" ? draft.content : draft.description}
                    onChange={(e) =>
                      setDraft({ ...draft, [modal === "page" ? "content" : "description"]: e.target.value })
                    }
                    placeholder="Add details…"
                  />
                </label>
              </>
            )}
            {error && <div className="error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Creating…" : "Create " + modal}
                <Plus size={16} />
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
