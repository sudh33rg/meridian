import { formatDate } from "../../lib/datetime";
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus, FileText, Home } from "lucide-react";
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
import { useToast } from "../shared/Toast";
import { errorMessage } from "../../lib/api";

/** Pages as a tree: children sit under their parent, and a page whose parent is not shown is a root. */
function PageTree({
  pages,
  activeId,
  homeId,
  onOpen,
}: {
  pages: Page[];
  activeId?: string;
  homeId: string | null;
  onOpen: (p: Page) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const shown = new Set(pages.map((p) => p.id));
  const roots = pages.filter((p) => !p.parent_id || !shown.has(p.parent_id));
  const childrenOf = (id: string) =>
    pages.filter((p) => p.parent_id === id).sort((a, b) => a.title.localeCompare(b.title));
  const toggle = (id: string) =>
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const render = (p: Page, depth: number): React.ReactNode => {
    const kids = childrenOf(p.id);
    const open = !collapsed.has(p.id);
    return (
      <React.Fragment key={p.id}>
        <div className="page-row" style={{ paddingLeft: depth * 14 }}>
          {kids.length > 0 ? (
            <button
              type="button"
              className="icon-btn"
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} ${p.title}`}
              onClick={() => toggle(p.id)}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : (
            <span className="page-row-spacer" aria-hidden="true" />
          )}
          <button
            className={"page-link " + (activeId === p.id ? "active" : "")}
            aria-current={activeId === p.id ? "page" : undefined}
            onClick={() => onOpen(p)}
          >
            <FileText size={16} />
            {p.title}
            {homeId === p.id && (
              <span className="tag" style={{ marginLeft: 6 }}>
                <Home size={11} /> Home
              </span>
            )}
          </button>
        </div>
        {open && kids.map((k) => render(k, depth + 1))}
      </React.Fragment>
    );
  };
  return <>{roots.map((r) => render(r, 0))}</>;
}

/** Blog posts: pages listed by publication date, with a box to publish a new one. */
function BlogPanel({ token, projectId, pages, onOpen }: { token: string; projectId: string; pages: Page[]; onOpen: (p: Page) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const blogQ = useQuery({
    queryKey: ["blog-posts", projectId],
    queryFn: () => api<{ page_id: string; title: string; published_at: string }[]>(`/projects/${projectId}/blog-posts`, token),
    enabled: !!projectId,
  });
  const publish = useMutation({
    mutationFn: () => send<Page>(`/projects/${projectId}/blog-posts`, token, "POST", { title: title.trim() }),
    onSuccess: (p) => {
      setTitle("");
      toast("Blog post published");
      void qc.invalidateQueries({ queryKey: ["blog-posts", projectId] });
      void qc.invalidateQueries({ queryKey: ["pages", projectId] });
      onOpen(p);
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });
  return (
    <section className="blog-panel" aria-label="Blog">
      <h3>Blog</h3>
      {(blogQ.data ?? []).map((b) => {
        const page = pages.find((p) => p.id === b.page_id);
        return page ? (
          <button key={b.page_id} className="page-link" onClick={() => onOpen(page)}>
            {b.title} <span className="muted small">{formatDate(b.published_at)}</span>
          </button>
        ) : null;
      })}
      {!(blogQ.data ?? []).length && <div className="panel-empty">No blog posts yet</div>}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) publish.mutate();
        }}
      >
        <input aria-label="Blog post title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New blog post" />
        <button className="secondary" type="submit" disabled={!title.trim() || publish.isPending}>
          Publish
        </button>
      </form>
    </section>
  );
}

export function KnowledgeTab() {
  const { pages, tab, setModal, activePage, setActivePage, session, selected } = useWorkspace();
  const homeQ = useQuery({
    queryKey: ["home-page", selected],
    queryFn: () => api<{ page_id: string | null }>(`/projects/${selected}/home-page`, session.token),
    enabled: !!selected && tab === "knowledge",
  });
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
            <PageTree
              pages={pages}
              activeId={activePage?.id}
              homeId={homeQ.data?.page_id ?? null}
              onOpen={(p) => setActivePage(p)}
            />
            {!pages.length && <div className="panel-empty">No pages yet</div>}
            <BlogPanel token={session.token} projectId={selected} pages={pages} onOpen={(p) => setActivePage(p)} />
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
  const { session, selected, activePage, setActivePage, setPages, me, pages } = useWorkspace();
  const page = activePage!;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAccess, setShowAccess] = useState(false);
  const [title, setTitle] = useState(page.title);
  const homeQ = useQuery({
    queryKey: ["home-page", selected],
    queryFn: () => api<{ page_id: string | null }>(`/projects/${selected}/home-page`, session.token),
    enabled: !!selected,
  });
  const setHome = useMutation({
    mutationFn: (pageId: string | null) => send(`/projects/${selected}/home-page`, session.token, "PUT", { page_id: pageId }),
    onSuccess: (_r, pageId) => {
      toast(pageId ? "Set as the project home page" : "Home page cleared");
      void qc.invalidateQueries({ queryKey: ["home-page", selected] });
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });
  // A page cannot be placed under itself or under one of its own children.
  const descendants = new Set<string>([page.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) {
      if (p.parent_id && descendants.has(p.parent_id) && !descendants.has(p.id)) {
        descendants.add(p.id);
        grew = true;
      }
    }
  }
  const moveTo = useMutation({
    mutationFn: (parentId: string | null) => send<Page>(`/pages/${page.id}/parent`, session.token, "PUT", { parent_id: parentId }),
    onSuccess: () => {
      toast("Page moved");
      void qc.invalidateQueries({ queryKey: ["pages", selected] });
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });
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
          <label className="muted small">
            Parent{" "}
            <select
              aria-label="Parent page"
              value={page.parent_id ?? ""}
              disabled={moveTo.isPending}
              onChange={(e) => moveTo.mutate(e.target.value || null)}
            >
              <option value="">Top level</option>
              {pages
                .filter((p) => !descendants.has(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="secondary"
            aria-pressed={homeQ.data?.page_id === page.id}
            disabled={setHome.isPending}
            onClick={() => setHome.mutate(homeQ.data?.page_id === page.id ? null : page.id)}
          >
            <Home size={14} /> {homeQ.data?.page_id === page.id ? "Home page" : "Set as home"}
          </button>
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
