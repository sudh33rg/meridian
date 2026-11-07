import React, { createContext, useContext, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { api, errorMessage, send } from "../../lib/api";
import { clearSession, saveSession as persistSession, type Me } from "../../lib/session";
import type { Issue, Page, Project, Session } from "../../lib/types";
import type { ExtraTab } from "../advanced/AdvancedWorkspace";

export type Tab = "overview" | "board" | "issues" | "knowledge" | ExtraTab;
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

  const token = session.token;
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
    queryFn: () => api<Issue[]>(`/projects/${selected}/issues`, token),
    enabled: !!selected,
  });
  const pagesQ = useQuery({
    queryKey: ["pages", selected],
    queryFn: () => api<Page[]>(`/projects/${selected}/pages`, token),
    enabled: !!selected,
  });
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
      navigate({ to: "/$tab", params: { tab: "overview" }, search: { project: p.id } });
    },
  });
  const createIssue = useMutation({
    mutationFn: () =>
      send<Issue>(`/projects/${selected}/issues`, token, "POST", {
        title: draft.title,
        description: draft.description,
        kind: draft.kind,
        priority: draft.priority,
      }),
    onSuccess: (i) => {
      qc.setQueryData<Issue[]>(["issues", selected], (old) => [i, ...(old ?? [])]);
      setTab("board");
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
    move: (issue: Issue, status: string) => moveIssue.mutate({ issue, status }),
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
