import React from "react";
import { FolderKanban, Layers3, Plus, X } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { api } from "../../lib/api";
import type { Page } from "../../lib/types";
import { AdvancedWorkspace, type ExtraTab } from "../advanced/AdvancedWorkspace";
import { OverviewTab } from "./OverviewTab";
import { BoardTab } from "./BoardTab";
import { IssuesTab } from "./IssuesTab";
import { KnowledgeTab } from "./KnowledgeTab";

export function Content() {
  const {
    session,
    setSession,
    project,
    selected,
    setSelected,
    tab,
    setTab,
    error,
    setError,
    setModal,
    setActivePage,
    setSelectedIssue,
    setPages,
  } = useWorkspace();
  return (
    <div className="content">
      {["overview", "board", "issues", "knowledge"].includes(tab) && (
        <div className="heading">
          <div>
            <div className="eyebrow blue">WORKSPACE / {project?.key || "HOME"}</div>
            <h1>
              {tab === "overview"
                ? "Good to see you, " + session.name.split(" ")[0] + "."
                : tab === "board"
                  ? "Project board"
                  : tab === "issues"
                    ? "All work"
                    : "Knowledge hub"}
            </h1>
            <p>
              {tab === "overview"
                ? "Here’s the pulse of your work today."
                : tab === "board"
                  ? "Track progress and move work forward."
                  : tab === "issues"
                    ? "A clear view of every task and priority."
                    : "Everything your team knows, in one place."}
            </p>
          </div>
          <div className="heading-actions">
            <button className="secondary" onClick={() => setModal("project")}>
              <FolderKanban size={16} /> New project
            </button>
            {project && (
              <button className="primary" onClick={() => setModal(tab === "knowledge" ? "page" : "issue")}>
                <Plus size={17} /> {tab === "knowledge" ? "New page" : "New issue"}
              </button>
            )}
          </div>
        </div>
      )}
      {error && (
        <div className="error app-error">
          {error}
          <button onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!project &&
      [
        "overview",
        "board",
        "issues",
        "knowledge",
        "sprints",
        "releases",
        "goals",
        "risks",
        "decisions",
        "analytics",
        "automation",
        "approvals",
      ].includes(tab) ? (
        <div className="empty">
          <Layers3 size={32} />
          <h2>Start with your first project</h2>
          <p>Create a project to begin tracking work and documenting knowledge.</p>
          <button className="primary" onClick={() => setModal("project")}>
            <Plus size={18} /> Create project
          </button>
        </div>
      ) : (
        <>
          <OverviewTab />
          <BoardTab />
          <IssuesTab />
          <KnowledgeTab />
        </>
      )}
      {!["overview", "board", "issues", "knowledge"].includes(tab) && (
        <AdvancedWorkspace
          key={`${tab}:${selected}`}
          tab={tab as ExtraTab}
          session={session}
          project={project}
          onSessionChange={setSession}
          onError={setError}
          onOpenSearch={async (item) => {
            const id = String(item.id),
              projectId = String(item.project_id);
            setSelected(projectId);
            if (item.kind === "issue") {
              setTab("issues");
              setSelectedIssue(id);
            } else {
              setTab("knowledge");
              const all = await api<Page[]>(`/projects/${projectId}/pages`, session.token).catch(() => []);
              setActivePage(all.find((x) => x.id === id) || null);
              setPages(projectId, all);
            }
          }}
        />
      )}
    </div>
  );
}
