import React, { useEffect } from "react";
import { Menu } from "lucide-react";
import { useWorkspace } from "./useWorkspace";
import { MFA_REQUIRED_EVENT } from "../../lib/api";
import { Sidebar } from "../shell/Sidebar";
import { Topbar } from "../shell/Topbar";
import { BottomNav } from "../shell/BottomNav";
import { CommandPalette } from "../shell/CommandPalette";
import { ShortcutsHelp, useGlobalShortcuts } from "../shell/Shortcuts";
import { Content } from "../work/Content";
import { CreateModal } from "../work/CreateModal";
import { IssueDrawer } from "../advanced/IssueDrawer";

export function WorkspaceApp() {
  const { session, selectedIssue, setSelectedIssue, refreshIssues, setError, setTab, setMobileMenu } =
    useWorkspace();
  useGlobalShortcuts();

  useEffect(() => {
    const go = () => setTab("security");
    window.addEventListener(MFA_REQUIRED_EVENT, go);
    return () => window.removeEventListener(MFA_REQUIRED_EVENT, go);
  }, [setTab]);

  return (
    <div className="min-h-screen bg-bg text-text-main flex flex-col md:flex-row antialiased overflow-x-hidden">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 z-50 px-4 py-2 bg-accent text-white rounded-lg shadow-lg font-semibold text-sm"
        href="#main-content"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <Topbar />
        <main
          className="flex-1 overflow-y-auto px-3.5 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8 pb-24 md:pb-8"
          id="main-content"
          tabIndex={-1}
        >
          <Content />
        </main>
      </div>
      <BottomNav onMore={() => setMobileMenu(true)} moreIcon={<Menu size={19} />} />
      {selectedIssue && (
        <IssueDrawer
          id={selectedIssue}
          token={session.token}
          onClose={() => setSelectedIssue(null)}
          onChanged={() => {
            refreshIssues().catch((e) => setError(e.message));
          }}
        />
      )}
      <CreateModal />
      <CommandPalette />
      <ShortcutsHelp />
    </div>
  );
}
