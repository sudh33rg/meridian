import React from "react";
import {
  Lock,
  LayoutDashboard,
  BookOpen,
  Plus,
  ChevronDown,
  LogOut,
  X,
  KanbanSquare,
  ListTodo,
  ShieldCheck,
} from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";

export function Sidebar() {
  const {
    session,
    projects,
    selected,
    setSelected,
    tab,
    setTab,
    setModal,
    mobileMenu,
    setMobileMenu,
    setActivePage,
    logout,
  } = useWorkspace();
  return (
    <aside className={"sidebar " + (mobileMenu ? "open" : "")}>
      <div className="brand">
        <span className="mark">M</span>
        <span>
          meridian<span className="brand-dot">.</span>
        </span>
        <button className="sidebar-close" onClick={() => setMobileMenu(false)}>
          <X size={18} />
        </button>
      </div>
      <button className="workspace" onClick={() => setTab("people")}>
        <span className="workspace-avatar">{session.organization[0]?.toUpperCase()}</span>
        <span>
          <b>{session.organization}</b>
          <small>Workspace</small>
        </span>
        <ChevronDown size={15} />
      </button>
      <div className="nav-group">
        <div className="nav-caption">WORKSPACE</div>
        <button
          className={tab === "overview" ? "nav active" : "nav"}
          onClick={() => {
            setTab("overview");
            setMobileMenu(false);
          }}
        >
          <LayoutDashboard size={18} /> Overview
        </button>
        <button
          className={tab === "board" ? "nav active" : "nav"}
          onClick={() => {
            setTab("board");
            setMobileMenu(false);
          }}
        >
          <KanbanSquare size={18} /> Board
        </button>
        <button
          className={tab === "issues" ? "nav active" : "nav"}
          onClick={() => {
            setTab("issues");
            setMobileMenu(false);
          }}
        >
          <ListTodo size={18} /> All work
        </button>
        <button
          className={tab === "knowledge" ? "nav active" : "nav"}
          onClick={() => {
            setTab("knowledge");
            setMobileMenu(false);
          }}
        >
          <BookOpen size={18} /> Knowledge
        </button>
      </div>
      <div className="nav-group nav-subgroup">
        <div className="nav-caption">PLAN &amp; CONNECT</div>
        {(
          [
            ["sprints", "Sprints"],
            ["releases", "Releases"],
            ["goals", "Goals"],
            ["risks", "Risks"],
            ["decisions", "Decisions"],
            ["analytics", "Analytics"],
            ["portfolio", "Portfolio"],
            ["approvals", "Approvals"],
            ["access", "Access"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "nav active" : "nav"}
            onClick={() => {
              setTab(id);
              setMobileMenu(false);
            }}
          >
            <span className="nav-bullet" />
            {label}
          </button>
        ))}
      </div>
      <div className="nav-group nav-subgroup">
        <div className="nav-caption">ORGANIZATION</div>
        {(
          [
            ["search", "Search"],
            ["inbox", "Inbox"],
            ["people", "People"],
            ["automation", "Automations"],
            ["integrations", "Integrations"],
            ["security", "Security"],
            ["identity", "Identity & SSO"],
            ["billing", "Billing"],
            ["audit", "Audit log"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "nav active" : "nav"}
            onClick={() => {
              setTab(id);
              setMobileMenu(false);
            }}
          >
            <span className="nav-bullet" />
            {label}
          </button>
        ))}
      </div>
      <div className="nav-group projects-nav">
        <div className="nav-caption row-between">
          YOUR PROJECTS{" "}
          <button className="icon-btn" title="New project" onClick={() => setModal("project")}>
            <Plus size={16} />
          </button>
        </div>
        {projects.map((p) => (
          <button
            key={p.id}
            className={"project-nav " + (p.id === selected ? "selected" : "")}
            onClick={() => {
              setSelected(p.id);
              setActivePage(null);
              setMobileMenu(false);
            }}
          >
            <span className="project-icon">{p.key.slice(0, 2)}</span>
            <span>{p.name}</span>
            {p.visibility === "private" && <Lock size={13} aria-label="Private project" />}
          </button>
        ))}
        {!projects.length && <div className="muted small pad">No projects yet</div>}
      </div>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <ShieldCheck size={16} /> Private tenant workspace
        </div>
        <button className="profile" onClick={logout}>
          <span className="profile-avatar">{session.name[0]?.toUpperCase()}</span>
          <span>
            <b>{session.name}</b>
            <small>Sign out</small>
          </span>
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}
