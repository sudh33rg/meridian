import React from "react";
import { FolderKanban, Layers3, Plus, X } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { api } from "../../lib/api";
import type { Page } from "../../lib/types";
import { AdvancedWorkspace, type ExtraTab } from "../advanced/AdvancedWorkspace";
import { IdentityPanel } from "../admin/IdentityPanel";
import { BillingPanel } from "../admin/BillingPanel";
import { WebhooksPanel } from "../admin/WebhooksPanel";
import { AppearancePanel } from "../workspace/AppearancePanel";
import { SecurityPanel } from "../advanced/SecurityPanel";
import { AccessPanel } from "../advanced/AccessPanel";
import { Skeleton } from "../shared/Avatar";
import { OverviewTab } from "./OverviewTab";
import { BoardTab } from "./BoardTab";
import { IssuesTab } from "./IssuesTab";
import { KnowledgeTab } from "./KnowledgeTab";
import { BacklogTab } from "../agile/BacklogTab";
import { SprintsPanel } from "../agile/SprintsPanel";
import { ReleasesPanel } from "../agile/ReleasesPanel";
import { ReportsPanel } from "../agile/ReportsPanel";

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
    me,
    projectsLoading,
    resendVerification,
    verificationSent,
  } = useWorkspace();
  const needsProject = [
    "overview",
    "board",
    "backlog",
    "issues",
    "knowledge",
    "sprints",
    "releases",
    "reports",
    "goals",
    "risks",
    "decisions",
    "analytics",
    "automation",
    "approvals",
    "access",
  ].includes(tab);
  return (
    <div className="content">
      {me && !me.email_verified && (
        <div className="banner">
          <span>Please confirm your email address — we sent you a link.</span>
          <button disabled={verificationSent} onClick={resendVerification}>
            {verificationSent ? "Email sent" : "Resend email"}
          </button>
        </div>
      )}
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
      {!project && needsProject && projectsLoading ? (
        <div className="empty" aria-busy="true">
          <Skeleton w={220} h={18} />
        </div>
      ) : !project && needsProject ? (
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
          <BacklogTab />
          <SprintsPanel />
          <ReleasesPanel />
          <ReportsPanel />
          <IssuesTab />
          <KnowledgeTab />
        </>
      )}
      {tab === "security" && <SecurityPanel />}
      {tab === "identity" && <IdentityPanel />}
      {tab === "billing" && <BillingPanel />}
      {tab === "integrations" && <WebhooksPanel />}
      {tab === "access" && project && <AccessPanel />}
      {tab === "appearance" && <AppearancePanel />}
      {![
        "overview",
        "board",
        "backlog",
        "sprints",
        "releases",
        "reports",
        "issues",
        "knowledge",
        "security",
        "access",
        "identity",
        "billing",
        "integrations",
        "appearance",
      ].includes(tab) && (
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
