import React from "react";
import { BookOpen, Plus, FileText } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import type { Page } from "../../lib/types";
import { api } from "../../lib/api";
import { PageHistory } from "../advanced/PageHistory";
import { EntityRelations } from "../advanced/EntityRelations";

export function KnowledgeTab() {
  const { session, pages, selected, tab, setModal, activePage, setActivePage, savePage, setPages } =
    useWorkspace();
  return (
    <>
      {tab === "knowledge" && (
        <div className="knowledge">
          <div className="pages-list">
            <div className="panel-head">
              <h3>Pages</h3>
              <button onClick={() => setModal("page")}>
                <Plus size={17} />
              </button>
            </div>
            {pages.map((p) => (
              <button
                className={"page-link " + (activePage?.id === p.id ? "active" : "")}
                key={p.id}
                onClick={() => setActivePage(p)}
              >
                <FileText size={16} />
                {p.title}
              </button>
            ))}
            {!pages.length && <div className="panel-empty">No pages yet</div>}
          </div>
          <div className="page-editor">
            {activePage ? (
              <>
                <div className="editor-head">
                  <span>Document · Version {activePage.version}</span>
                  <div className="heading-actions">
                    <PageHistory
                      id={activePage.id}
                      token={session.token}
                      expectedVersion={activePage.version}
                      onRestore={async () => {
                        const updated = await api<Page[]>(`/projects/${selected}/pages`, session.token);
                        setPages(selected, updated);
                        setActivePage(updated.find((x) => x.id === activePage.id) || null);
                      }}
                    />
                    <button className="primary" onClick={savePage}>
                      Save changes
                    </button>
                  </div>
                </div>
                <input
                  className="page-title"
                  value={activePage.title}
                  onChange={(e) => setActivePage({ ...activePage, title: e.target.value })}
                />
                <textarea
                  className="page-content"
                  value={activePage.content}
                  onChange={(e) => setActivePage({ ...activePage, content: e.target.value })}
                  placeholder="Start writing your knowledge…"
                />
                <div className="editor-note">Plain-text editor · Optimistic version checks</div>
                <div className="editor-relations">
                  <h3>Connected work</h3>
                  <EntityRelations
                    key={activePage.id}
                    token={session.token}
                    sourceType="page"
                    sourceId={activePage.id}
                    projectId={selected}
                    targetType="issue"
                  />
                </div>
              </>
            ) : (
              <div className="editor-empty">
                <BookOpen size={30} />
                <h3>Knowledge belongs next to work.</h3>
                <p>Select a page or create one to get started.</p>
                <button className="primary" onClick={() => setModal("page")}>
                  <Plus size={16} /> New page
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
