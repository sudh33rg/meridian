import React, { useEffect } from "react";
import { useWorkspace } from "./useWorkspace";
import { MFA_REQUIRED_EVENT } from "../../lib/api";
import { Sidebar } from "../shell/Sidebar";
import { Topbar } from "../shell/Topbar";
import { Content } from "../work/Content";
import { CreateModal } from "../work/CreateModal";
import { IssueDrawer } from "../advanced/IssueDrawer";

export function WorkspaceApp() {
  const { session, selectedIssue, setSelectedIssue, refreshIssues, setError, setTab } = useWorkspace();
  // A workspace that requires MFA blocks everything else until the member sets it up.
  useEffect(() => {
    const go = () => setTab("security");
    window.addEventListener(MFA_REQUIRED_EVENT, go);
    return () => window.removeEventListener(MFA_REQUIRED_EVENT, go);
  }, [setTab]);
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <Topbar />
        <Content />
      </main>
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
    </div>
  );
}
