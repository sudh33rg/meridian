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
  // A workspace that requires MFA blocks everything else until the member sets it up.
  useEffect(() => {
    const go = () => setTab("security");
    window.addEventListener(MFA_REQUIRED_EVENT, go);
    return () => window.removeEventListener(MFA_REQUIRED_EVENT, go);
  }, [setTab]);
  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar />
      <main className="main" id="main-content" tabIndex={-1}>
        <Topbar />
        <Content />
      </main>
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
