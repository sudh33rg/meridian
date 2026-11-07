import React from "react";
import { Plus, X } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";

export function CreateModal() {
  const { error, busy, modal, setModal, draft, setDraft, create } = useWorkspace();
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
                {modal === "issue" && (
                  <div className="form-row">
                    <label>
                      Type
                      <select
                        value={draft.kind}
                        onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                      >
                        {["task", "bug", "story", "epic"].map((x) => (
                          <option key={x}>{x}</option>
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
                  </div>
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
