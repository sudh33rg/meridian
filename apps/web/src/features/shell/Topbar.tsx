import React from "react";
import { Search, Menu } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";

export function Topbar() {
  const { session, project, setTab, setMobileMenu } = useWorkspace();
  return (
    <header className="topbar">
      <div className="breadcrumbs">
        <button className="mobile-trigger" onClick={() => setMobileMenu(true)}>
          <Menu />
        </button>
        <span>Workspace</span>
        <span className="slash">/</span>
        <span className="current">{project?.name || "Overview"}</span>
      </div>
      <div className="top-actions">
        <button className="secondary" onClick={() => setTab("search")}>
          <Search size={15} /> Search
        </button>
        <div className="mini-avatar">{session.name[0]?.toUpperCase()}</div>
      </div>
    </header>
  );
}
