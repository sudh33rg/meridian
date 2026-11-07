import React from "react";
import { useWorkspace } from "./useWorkspace";
import { Sidebar } from "../shell/Sidebar";
import { Topbar } from "../shell/Topbar";
import { Content } from "../work/Content";
import { CreateModal } from "../work/CreateModal";
import { IssueDrawer } from "../advanced/IssueDrawer";

export function WorkspaceApp() {
  const { session, selectedIssue, setSelectedIssue, refreshIssues, setError } = useWorkspace();
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
