import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  API_BASE,
  ApiError,
  api,
  errorMessage,
  newIdempotencyKey,
  send,
} from "../../lib/api";
import { loadIssues } from "../../lib/issues";
import { fallbackLabel, type ProjectStatus } from "../../lib/statuses";
import { clearSession, saveSession as persistSession, type Me } from "../../lib/session";
import type { Issue, Page, Project, Session } from "../../lib/types";
import type { ExtraTab } from "../advanced/AdvancedWorkspace";
import { useToast } from "../shared/Toast";

export type Tab = "overview" | "board" | "backlog" | "reports" | "roadmap" | "issues" | "knowledge" | "appearance" | ExtraTab;
export type Modal = "project" | "issue" | "page" | null;

const emptyDraft = {
  visibility: "workspace",
  name: "",
  key: "",
  description: "",
  title: "",
  content: "",
  kind: "task",
  priority: "medium",
  teamId: "",
};

function useWorkspaceState(session: Session, setSession: (s: Session | null) => void) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tab = (useParams({ strict: false }).tab ?? "overview") as Tab;
  const search = useSearch({ strict: false }) as { project?: string };
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [searchText, setSearch] = useState("");
  const [activePage, setActivePage] = useState<Page | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      return localStorage.getItem("meridian.sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const setCollapsed = (v: boolean | ((c: boolean) => boolean)) =>
    setCollapsedState((c) => {
      const n = typeof v === "function" ? v(c) : v;
      try {
        localStorage.setItem("meridian.sidebar", n ? "collapsed" : "open");
      } catch {
        /* ignore */
      }
      return n;
    });
  const { toast } = useToast();

  const token = session.token;
  // Live updates: the server pushes "something changed" notifications for what this user may
  // see; we just refetch the affected queries through the normal, authorized API.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let stopped = false;
    let retry: number | undefined;
    let flush: number | undefined;
    const pending = new Set<string>();
    const queue = (...keys: (readonly unknown[])[]) => {
      keys.forEach((k) => pending.add(JSON.stringify(k)));
      window.clearTimeout(flush);
      flush = window.setTimeout(() => {
        pending.forEach((k) => qc.invalidateQueries({ queryKey: JSON.parse(k) }));
        pending.clear();
      }, 150);
    };
    const open = (resync: boolean) => {
      es = new EventSource(`${API_BASE}/sync/stream`);
      // After a reconnect we may have missed events: refresh everything once.
      if (resync) es.onopen = () => qc.invalidateQueries();
      es.addEventListener("change", (e) => {
        const ev = JSON.parse((e as MessageEvent).data) as {
          entity_type: string;
          entity_id: string;
          project_id: string | null;
        };
        const p = ev.project_id;
        switch (ev.entity_type) {
          case "issue":
            queue(["issues", p], ["attachments", ev.entity_id]);
            break;
          case "page":
            queue(["pages", p], ["page-access", ev.entity_id], ["attachments", ev.entity_id]);
            break;
          case "project":
            queue(["projects"], ["access", p]);
            break;
          case "member":
          case "team":
            queue(["members"], ["teams"]);
            break;
          default:
            queue(["issues", p], ["pages", p]);
        }
      });
      es.onerror = () => {
        es?.close();
        if (!stopped) retry = window.setTimeout(() => open(true), 3000 + Math.random() * 2000);
      };
    };
    open(false);
    return () => {
      stopped = true;
      es?.close();
      window.clearTimeout(retry);
      window.clearTimeout(flush);
    };
  }, [qc, session.tenant_id]);
  const projectsQ = useQuery({
    queryKey: ["projects", session.tenant_id],
    queryFn: () => api<Project[]>("/projects", token),
  });
  const meQ = useQuery({ queryKey: ["me", session.tenant_id], queryFn: () => api<Me>("/me", token) });
  const [verificationSent, setVerificationSent] = useState(false);
  const resendVerification = () =>
    send<void>("/auth/resend-verification", token, "POST")
      .then(() => setVerificationSent(true))
      .catch((e) => setError(errorMessage(e)));
  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data]);
  const selected = projects.some((p) => p.id === search.project)
    ? (search.project as string)
    : projects[0]?.id || "";
  const project = projects.find((p) => p.id === selected);
  const issuesQ = useQuery({
    queryKey: ["issues", selected],
    queryFn: () => loadIssues(token, selected),
    enabled: !!selected,
  });
  const pagesQ = useQuery({
    queryKey: ["pages", selected],
    queryFn: () => api<Page[]>(`/projects/${selected}/pages`, token),
    enabled: !!selected,
  });
  const statusesQ = useQuery({
    queryKey: ["statuses", selected],
    queryFn: () => api<ProjectStatus[]>(`/projects/${selected}/statuses`, token),
    enabled: !!selected,
  });
  const statuses = useMemo(() => statusesQ.data ?? [], [statusesQ.data]);
  const statusLabel = useCallback(
    (key: string) => statuses.find((s) => s.key === key)?.name ?? fallbackLabel(key),
    [statuses],
  );
  const issues = useMemo(() => issuesQ.data ?? [], [issuesQ.data]);
  const pages = useMemo(() => pagesQ.data ?? [], [pagesQ.data]);
  const queryError = projectsQ.error || issuesQ.error || pagesQ.error;
  const shownError = error || (queryError ? errorMessage(queryError) : "");

  const setTab = (t: Tab) =>
    navigate({
      to: "/$tab",
      params: { tab: t },
      search: (prev: { project?: string }) => ({ project: prev.project }),
    });
  const setSelected = (id: string) => navigate({ to: "/$tab", params: { tab }, search: { project: id } });
  const filtered = useMemo(
    () =>
      issues.filter((i) =>
        (i.title + " " + i.kind + " " + i.number).toLowerCase().includes(searchText.toLowerCase()),
      ),
    [issues, searchText],
  );

  const createProject = useMutation({
    mutationFn: () =>
      send<Project>("/projects", token, "POST", {
        name: draft.name,
        key: draft.key.toUpperCase(),
        description: draft.description,
        visibility: draft.visibility,
      }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["projects"] });
      toast(`Project “${p.name}” created`);
      navigate({ to: "/$tab", params: { tab: "overview" }, search: { project: p.id } });
    },
  });
  const idemKey = useRef<string | undefined>(undefined);
  const createIssue = useMutation({
    mutationFn: () => {
      // One key per logical create. A retry after a network failure reuses it, so the server
      // returns the issue it already made instead of creating a second one.
      const key = (idemKey.current ??= newIdempotencyKey());
      return api<Issue>(`/projects/${selected}/issues`, token, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          title: draft.title,
          description: draft.description,
          kind: draft.kind,
          priority: draft.priority,
          team_id: draft.teamId || null,
        }),
      });
    },
    onSuccess: (i) => {
      idemKey.current = undefined;
      qc.setQueryData<Issue[]>(["issues", selected], (old) => [i, ...(old ?? [])]);
      toast(`Created ${project?.key ?? ""}-${i.number}`);
      setTab("board");
    },
    onError: (e) => {
      // A rejected request is never stored server-side, so a fresh key is safe. A network failure
      // keeps the key because the write may have succeeded.
      if (e instanceof ApiError) idemKey.current = undefined;
    },
  });
  const createPage = useMutation({
    mutationFn: () =>
      send<Page>(`/projects/${selected}/pages`, token, "POST", {
        title: draft.title,
        content: draft.content,
      }),
    onSuccess: (p) => {
      qc.setQueryData<Page[]>(["pages", selected], (old) => [p, ...(old ?? [])]);
      toast("Page created");
      setTab("knowledge");
      setActivePage(p);
    },
  });
  const moveIssue = useMutation({
    mutationFn: ({ issue, status }: { issue: Issue; status: string }) =>
      send<Issue>(`/issues/${issue.id}`, token, "PATCH", { status }),
    onMutate: async ({ issue, status }) => {
      await qc.cancelQueries({ queryKey: ["issues", selected] });
      qc.setQueryData<Issue[]>(["issues", selected], (old) =>
        (old ?? []).map((x) => (x.id === issue.id ? { ...x, status } : x)),
      );
    },
    onSuccess: (saved) =>
      qc.setQueryData<Issue[]>(["issues", selected], (old) =>
        (old ?? []).map((x) => (x.id === saved.id ? saved : x)),
      ),
    onError: (e, { issue }) => {
      qc.setQueryData<Issue[]>(["issues", selected], (old) =>
        (old ?? []).map((x) => (x.id === issue.id ? issue : x)),
      );
      setError(errorMessage(e));
    },
  });
  const savePageM = useMutation({
    mutationFn: (p: Page) =>
      send<Page>(`/pages/${p.id}`, token, "PATCH", {
        title: p.title,
        content: p.content,
        expected_version: p.version,
      }),
    onSuccess: (p) => {
      setActivePage(p);
      qc.setQueryData<Page[]>(["pages", selected], (old) => (old ?? []).map((x) => (x.id === p.id ? p : x)));
      setError("");
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const busy = createProject.isPending || createIssue.isPending || createPage.isPending;
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (modal === "project") await createProject.mutateAsync();
      if (modal === "issue") await createIssue.mutateAsync();
      if (modal === "page") await createPage.mutateAsync();
      setModal(null);
      setDraft(emptyDraft);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const logout = async () => {
    await api("/auth/logout", token, { method: "POST" }).catch(() => {});
    clearSession();
    qc.clear();
    setSession(null);
  };
  const refreshIssues = () => qc.invalidateQueries({ queryKey: ["issues", selected] });
  const setPages = (projectId: string, p: Page[]) => qc.setQueryData<Page[]>(["pages", projectId], p);

  return {
    session,
    setSession: (s: Session) => {
      persistSession(s);
      qc.clear();
      setSession(s);
    },
    me: meQ.data,
    resendVerification,
    verificationSent,
    projects,
    issues,
    statuses,
    statusLabel,
    pages,
    filtered,
    project,
    selected,
    setSelected,
    tab,
    setTab,
    error: shownError,
    setError,
    busy,
    modal,
    setModal,
    mobileMenu,
    setMobileMenu,
    draft,
    setDraft,
    search: searchText,
    setSearch,
    activePage,
    setActivePage,
    selectedIssue,
    setSelectedIssue,
    create,
    move: (issue: Issue, status: string) => {
      if (issue.status === status) return;
      moveIssue.mutate({ issue, status });
      toast(`${project?.key ?? ""}-${issue.number} moved to ${statusLabel(status)}`, {
        action: {
          label: "Undo",
          run: () => moveIssue.mutate({ issue: { ...issue, status }, status: issue.status }),
        },
      });
    },
    projectsLoading: projectsQ.isLoading,
    loading: issuesQ.isLoading || pagesQ.isLoading,
    paletteOpen,
    setPaletteOpen,
    helpOpen,
    setHelpOpen,
    collapsed,
    setCollapsed,
    savePage: () => activePage && savePageM.mutate(activePage),
    logout,
    refreshIssues,
    setPages,
  };
}

export type Workspace = ReturnType<typeof useWorkspaceState>;
const Ctx = createContext<Workspace | null>(null);

export function WorkspaceProvider({
  session,
  setSession,
  children,
}: {
  session: Session;
  setSession: (s: Session | null) => void;
  children: React.ReactNode;
}) {
  const value = useWorkspaceState(session, setSession);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useWorkspace(): Workspace {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return v;
}
