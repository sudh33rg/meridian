import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Plus, FileText } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import type { Page } from "../../lib/types";
import { api } from "../../lib/api";
import { PageHistory } from "../advanced/PageHistory";
import { EntityRelations } from "../advanced/EntityRelations";
import { CollabEditor } from "../knowledge/CollabEditor";
import { PageAccessPanel } from "../knowledge/PageAccessPanel";
import { Attachments } from "../shared/Attachments";
import { send } from "../../lib/api";
import { Lock } from "lucide-react";

export function KnowledgeTab() {
  const { pages, tab, setModal, activePage, setActivePage } = useWorkspace();
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
              <PageEditor key={activePage.id} />
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

/** One open page: live editor, history, restrictions and attachments. */
function PageEditor() {
  const { session, selected, activePage, setActivePage, setPages, me } = useWorkspace();
  const page = activePage!;
  const [showAccess, setShowAccess] = useState(false);
  const [title, setTitle] = useState(page.title);
  const access = useQuery({
    queryKey: ["page-access", page.id],
    queryFn: () => api<{ restricted: boolean; your_level: number }>(`/pages/${page.id}/access`),
  });
  const level = access.data?.your_level ?? 0;
  const canEdit = level >= 2;
  const rename = async () => {
    const t = title.trim();
    if (!t || t === page.title) return;
    await send<void>(`/pages/${page.id}/title`, "", "PUT", { title: t });
    setActivePage({ ...page, title: t });
  };
  return (
    <>
      <div className="editor-head">
        <span>
          Document · Version {page.version}
          {access.data?.restricted && (
            <span className="tag" style={{ marginLeft: 8 }}>
              <Lock size={11} /> Restricted
            </span>
          )}
        </span>
        <div className="heading-actions">
          <PageHistory
            id={page.id}
            token={session.token}
            expectedVersion={page.version}
            onRestore={async () => {
              const updated = await api<Page[]>(`/projects/${selected}/pages`, session.token);
              setPages(selected, updated);
              setActivePage(updated.find((x) => x.id === page.id) || null);
            }}
          />
          <button className="secondary" onClick={() => setShowAccess((v) => !v)}>
            <Lock size={14} /> Access
          </button>
        </div>
      </div>
      {showAccess && <PageAccessPanel pageId={page.id} onClose={() => setShowAccess(false)} />}
      <input
        className="page-title"
        value={title}
        readOnly={!canEdit}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void rename()}
        aria-label="Page title"
      />
      {access.isSuccess && (
        <CollabEditor pageId={page.id} canEdit={canEdit} userName={me?.name || session.name} />
      )}
      <Attachments entityType="page" entityId={page.id} canEdit={canEdit} />
      <div className="editor-relations">
        <h3>Connected work</h3>
        <EntityRelations
          key={page.id}
          token={session.token}
          sourceType="page"
          sourceId={page.id}
          projectId={selected}
          targetType="issue"
        />
      </div>
    </>
  );
}
