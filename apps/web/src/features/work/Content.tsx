import React from "react";
import { FolderKanban, Layers3, Plus, X, AlertTriangle } from "lucide-react";
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
import { PageHeader, EmptyState } from "../shared/UiComponents";
import { OverviewTab } from "./OverviewTab";
import { BoardTab } from "./BoardTab";
import { IssuesTab } from "./IssuesTab";
import { KnowledgeTab } from "./KnowledgeTab";
import { BacklogTab } from "../agile/BacklogTab";
import { SprintsPanel } from "../agile/SprintsPanel";
import { ReleasesPanel } from "../agile/ReleasesPanel";
import { ReportsPanel } from "../agile/ReportsPanel";
import { ApiTokensPanel, GitLinkPanel } from "../agile/IntegrationsPanels";
import { WorkspaceSettingsPanel } from "../agile/WorkspaceSettingsPanel";
import { RoadmapPanel } from "../agile/RoadmapPanel";
import { ServicePanel } from "../agile/ServicePanel";

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
    "roadmap",
    "service",
    "goals",
    "risks",
    "decisions",
    "analytics",
    "automation",
    "approvals",
    "access",
  ].includes(tab);

  return (
    <div className="max-w-7xl mx-auto w-full">
      {/* Unverified Email Banner */}
      {me && !me.email_verified && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm font-medium">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Please confirm your email address — we sent you a verification link.</span>
          </div>
          <button
            disabled={verificationSent}
            onClick={resendVerification}
            className="px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-60 transition-colors"
          >
            {verificationSent ? "Email sent" : "Resend email"}
          </button>
        </div>
      )}

      {/* Main Page Header for Core Views */}
      {["overview", "board", "issues", "knowledge"].includes(tab) && (
        <PageHeader
          eyebrow={`WORKSPACE / ${project?.key || "HOME"}`}
          title={
            tab === "overview"
              ? "Good to see you, " + session.name.split(" ")[0] + "."
              : tab === "board"
                ? "Project board"
                : tab === "issues"
                  ? "All work"
                  : "Knowledge hub"
          }
          subtitle={
            tab === "overview"
              ? "Here's the pulse of your work and active momentum today."
              : tab === "board"
                ? "Track progress, assign ownership, and move work across stages."
                : tab === "issues"
                  ? "A complete, searchable directory of tasks, bugs, and priorities."
                  : "Everything your team knows and documents, organized in one place."
          }
          actions={
            <>
              <button
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 shadow-2xs transition-colors cursor-pointer"
                onClick={() => setModal("project")}
              >
                <FolderKanban size={15} />
                <span>New project</span>
              </button>
              {project && (
                <button
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 shadow-xs transition-colors cursor-pointer"
                  onClick={() => setModal(tab === "knowledge" ? "page" : "issue")}
                >
                  <Plus size={16} />
                  <span>{tab === "knowledge" ? "New page" : "New issue"}</span>
                </button>
              )}
            </>
          }
        />
      )}

      {/* Global Error Banner */}
      {error && (
        <div className="error app-error mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 flex items-center justify-between gap-3 text-xs sm:text-sm font-medium">
          <span>{error}</span>
          <button
            onClick={() => setError("")}
            className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Empty Project State */}
      {!project && needsProject && projectsLoading ? (
        <div className="py-20 flex justify-center" aria-busy="true">
          <Skeleton w={240} h={20} />
        </div>
      ) : !project && needsProject ? (
        <EmptyState
          icon={Layers3}
          title="Start with your first project"
          description="Create a project to begin tracking tasks, organizing sprints, and documenting knowledge."
          action={{
            label: "Create project",
            icon: Plus,
            onClick: () => setModal("project"),
          }}
        />
      ) : (
        <>
          <OverviewTab />
          <BoardTab />
          <BacklogTab />
          <SprintsPanel />
          <ReleasesPanel />
          <ReportsPanel />
          <RoadmapPanel />
          <ServicePanel />
          <IssuesTab />
          <KnowledgeTab />
        </>
      )}

      {/* Settings / Admin views */}
      {tab === "security" && <SecurityPanel />}
      {tab === "identity" && <IdentityPanel />}
      {tab === "billing" && <BillingPanel />}
      {tab === "integrations" && (
        <div className="space-y-6">
          <WebhooksPanel />
          <ApiTokensPanel />
          <GitLinkPanel />
        </div>
      )}
      {tab === "access" && project && <AccessPanel />}
      {tab === "appearance" && (
        <div className="space-y-6">
          <AppearancePanel />
          <WorkspaceSettingsPanel />
        </div>
      )}

      {/* Extra Tabs / Advanced Workspace */}
      {![
        "overview",
        "board",
        "backlog",
        "sprints",
        "releases",
        "reports",
        "roadmap",
        "service",
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
