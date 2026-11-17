import { formatDate } from "../../lib/datetime";
import { PageBody } from "../../lib/macros";
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus, FileText, Home, Lock, MessageSquare, ChevronRight, ChevronDown } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import type { Page } from "../../lib/types";
import { api } from "../../lib/api";
import { PageHistory } from "../advanced/PageHistory";
import { EntityRelations } from "../advanced/EntityRelations";
import { CollabEditor } from "../knowledge/CollabEditor";
import { PageAccessPanel } from "../knowledge/PageAccessPanel";
import { InlineCommentsDrawer } from "../knowledge/InlineCommentsDrawer";
import { Attachments } from "../shared/Attachments";
import { send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { errorMessage } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

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
    const isActive = activeId === p.id;

    return (
      <React.Fragment key={p.id}>
        <div className="flex items-center gap-1 group py-0.5" style={{ paddingLeft: `${depth * 14}px` }}>
          {kids.length > 0 ? (
            <button
              type="button"
              className="p-1 rounded text-text-muted hover:text-text-main transition-colors cursor-pointer"
              aria-expanded={open}
              aria-label={`${open ? "Collapse" : "Expand"} ${p.title}`}
              onClick={() => toggle(p.id)}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden="true" />
          )}

          <button
            className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors text-left cursor-pointer truncate ${
              isActive ? "bg-accent-soft text-accent font-bold" : "text-text-main hover:bg-surface-3"
            }`}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onOpen(p)}
          >
            <FileText size={15} className={`shrink-0 ${isActive ? "text-accent" : "text-text-muted"}`} />
            <span className="truncate flex-1">{p.title}</span>
            {homeId === p.id && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-warning-soft text-warning-text border border-warning-border shrink-0">
                <Home size={10} /> Home
              </span>
            )}
          </button>
        </div>
        {open && kids.map((k) => render(k, depth + 1))}
      </React.Fragment>
    );
  };

  return <div className="space-y-0.5">{roots.map((r) => render(r, 0))}</div>;
}

/** Blog posts: pages listed by publication date, with a box to publish a new one. */
function BlogPanel({
  token,
  projectId,
  pages,
  onOpen,
}: {
  token: string;
  projectId: string;
  pages: Page[];
  onOpen: (p: Page) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");

  const blogQ = useQuery({
    queryKey: ["blog-posts", projectId],
    queryFn: () =>
      api<{ page_id: string; title: string; published_at: string }[]>(
        `/projects/${projectId}/blog-posts`,
        token,
      ),
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
    <section className="mt-6 pt-4 border-t border-border space-y-3" aria-label="Blog">
      <h4 className="text-xs font-bold uppercase tracking-wider text-text-subtle m-0">
        Blog & Announcements
      </h4>
      <div className="space-y-1">
        {(blogQ.data ?? []).map((b) => {
          const page = pages.find((p) => p.id === b.page_id);
          return page ? (
            <button
              key={b.page_id}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-main hover:bg-surface-3 transition-colors text-left cursor-pointer"
              onClick={() => onOpen(page)}
            >
              <span className="truncate">{b.title}</span>
              <span className="text-[10px] text-text-muted shrink-0">{formatDate(b.published_at)}</span>
            </button>
          ) : null;
        })}
        {!(blogQ.data ?? []).length && (
          <div className="py-2 text-xs text-text-muted italic">No blog posts yet</div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) publish.mutate();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          aria-label="Blog post title"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New post title…"
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-xs border border-border bg-surface-2 text-text-main"
        />
        <button
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-surface-2 text-text-main hover:bg-surface-3 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          type="submit"
          disabled={!title.trim() || publish.isPending}
        >
          Publish
        </button>
      </form>
    </section>
  );
}

export function KnowledgeTab() {
  const { pages, tab, setModal, activePage, setActivePage, session, selected } = useWorkspace();
  const [mobileTab, setMobileTab] = useState<"sidebar" | "doc">("doc");

  const homeQ = useQuery({
    queryKey: ["home-page", selected],
    queryFn: () => api<{ page_id: string | null }>(`/projects/${selected}/home-page`, session.token),
    enabled: !!selected && tab === "knowledge",
  });

  if (tab !== "knowledge") return null;

  return (
    <div className="space-y-4">
      {/* Mobile switcher: Document vs Pages Tree */}
      <div className="flex sm:hidden items-center justify-between bg-surface p-1.5 rounded-xl border border-border">
        <button
          onClick={() => setMobileTab("sidebar")}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
            mobileTab === "sidebar" ? "bg-accent text-white" : "text-text-muted"
          }`}
        >
          Pages Directory ({pages.length})
        </button>
        <button
          onClick={() => setMobileTab("doc")}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
            mobileTab === "doc" ? "bg-accent text-white" : "text-text-muted"
          }`}
        >
          Document Viewer
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Left: Pages Tree Sidebar */}
        <div className={`w-full lg:w-72 shrink-0 ${mobileTab === "sidebar" ? "block" : "hidden lg:block"}`}>
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">
                <FileText size={16} className="text-accent" />
                Knowledge Pages
              </CardTitle>
              <button
                onClick={() => setModal("page")}
                aria-label="New page"
                className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-3 transition-colors cursor-pointer"
              >
                <Plus size={16} />
              </button>
            </CardHeader>

            <CardContent className="p-3">
              <PageTree
                pages={pages}
                activeId={activePage?.id}
                homeId={homeQ.data?.page_id ?? null}
                onOpen={(p) => {
                  setActivePage(p);
                  setMobileTab("doc");
                }}
              />
              {!pages.length && <div className="py-8 text-center text-xs text-text-muted">No pages yet</div>}

              <BlogPanel
                token={session.token}
                projectId={selected}
                pages={pages}
                onOpen={(p) => {
                  setActivePage(p);
                  setMobileTab("doc");
                }}
              />
            </CardContent>
          </Card>
        </div>

        {/* Right: Active Document Canvas */}
        <div className={`flex-1 min-w-0 w-full ${mobileTab === "doc" ? "block" : "hidden lg:block"}`}>
          {activePage ? (
            <PageEditor key={activePage.id} />
          ) : (
            <Card className="py-16 px-6 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-accent-soft text-accent flex items-center justify-center">
                <BookOpen size={28} />
              </div>
              <h3 className="text-lg font-bold text-text-main mb-1.5">
                Knowledge belongs right next to work.
              </h3>
              <p className="text-xs sm:text-sm text-text-muted max-w-sm mx-auto mb-6">
                Select a document from the left directory or create a new page to write notes, RFCs, and
                release specs.
              </p>
              <button
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold text-white bg-accent hover:bg-accent-strong transition-colors cursor-pointer"
                onClick={() => setModal("page")}
              >
                <Plus size={16} /> New page
              </button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** One open page: live editor, history, restrictions and attachments. */
function PageEditor() {
  const { session, selected, activePage, setActivePage, setPages, me, pages } = useWorkspace();
  const page = activePage!;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAccess, setShowAccess] = useState(false);
  const [showInline, setShowInline] = useState(false);
  const [title, setTitle] = useState(page.title);

  const homeQ = useQuery({
    queryKey: ["home-page", selected],
    queryFn: () => api<{ page_id: string | null }>(`/projects/${selected}/home-page`, session.token),
    enabled: !!selected,
  });

  const setHome = useMutation({
    mutationFn: (pageId: string | null) =>
      send(`/projects/${selected}/home-page`, session.token, "PUT", { page_id: pageId }),
    onSuccess: (_r, pageId) => {
      toast(pageId ? "Set as the project home page" : "Home page cleared");
      void qc.invalidateQueries({ queryKey: ["home-page", selected] });
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });

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
    mutationFn: (parentId: string | null) =>
      send<Page>(`/pages/${page.id}/parent`, session.token, "PUT", { parent_id: parentId }),
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
    <Card className="overflow-hidden">
      {/* Top Document Header Controls */}
      <div className="p-4 sm:p-5 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span>Document · Version {page.version}</span>
          {access.data?.restricted && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning-soft text-warning-text border border-warning-border">
              <Lock size={10} /> Restricted
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="hidden sm:inline">Parent:</span>
            <select
              aria-label="Parent page"
              value={page.parent_id ?? ""}
              disabled={moveTo.isPending}
              onChange={(e) => moveTo.mutate(e.target.value || null)}
              className="px-2 py-1 rounded-md text-xs border border-border bg-surface-2 text-text-main"
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
          </div>

          <button
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
              homeQ.data?.page_id === page.id
                ? "bg-warning-soft border-warning-border text-warning-text"
                : "border-border bg-surface-2 hover:bg-surface-3 text-text-main"
            }`}
            aria-pressed={homeQ.data?.page_id === page.id}
            disabled={setHome.isPending}
            onClick={() => setHome.mutate(homeQ.data?.page_id === page.id ? null : page.id)}
          >
            <Home size={13} /> {homeQ.data?.page_id === page.id ? "Home page" : "Set as home"}
          </button>

          <button
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border border-border bg-surface-2 hover:bg-surface-3 text-text-main transition-colors cursor-pointer"
            onClick={() => setShowAccess((v) => !v)}
          >
            <Lock size={13} /> Access
          </button>

          <button
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border border-border bg-surface-2 hover:bg-surface-3 text-text-main transition-colors cursor-pointer"
            onClick={() => setShowInline((v) => !v)}
          >
            <MessageSquare size={13} /> Comments
          </button>
        </div>
      </div>

      {showAccess && <PageAccessPanel pageId={page.id} onClose={() => setShowAccess(false)} />}
      {showInline && (
        <InlineCommentsDrawer pageId={page.id} pageTitle={page.title} onClose={() => setShowInline(false)} />
      )}

      {/* Editor Body */}
      <CardContent className="p-4 sm:p-8 space-y-6">
        <input
          className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text-main font-display border-0 bg-transparent focus:outline-hidden w-full m-0 p-0"
          value={title}
          readOnly={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void rename()}
          aria-label="Page title"
        />

        {access.isSuccess && (
          <CollabEditor pageId={page.id} canEdit={canEdit} userName={me?.name || session.name} />
        )}

        {page.content.includes("{{") && (
          <section className="pt-6 border-t border-border" aria-label="Rendered page">
            <h4 className="text-xs font-bold uppercase tracking-wider text-text-subtle mb-3">
              Rendered view
            </h4>
            <div className="prose dark:prose-invert max-w-none">
              <PageBody content={page.content} token={session.token} projectId={selected} />
            </div>
          </section>
        )}

        <div className="pt-6 border-t border-border">
          <Attachments entityType="page" entityId={page.id} canEdit={canEdit} />
        </div>

        <div className="pt-6 border-t border-border space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-text-subtle m-0">
            Connected Work & Issues
          </h4>
          <EntityRelations
            key={page.id}
            token={session.token}
            sourceType="page"
            sourceId={page.id}
            projectId={selected}
            targetType="issue"
          />
        </div>
      </CardContent>
    </Card>
  );
}
