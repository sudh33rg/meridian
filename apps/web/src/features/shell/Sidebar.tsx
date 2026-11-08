import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { Avatar } from "../shared/Avatar";
import { NAV, NAV_GROUPS, type NavGroupId } from "./nav";

const FOLD_KEY = "meridian.nav.folded";
const loadFolded = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) || "{}");
  } catch {
    return {};
  }
};

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
    collapsed,
    setCollapsed,
    setPaletteOpen,
    me,
  } = useWorkspace();
  const [folded, setFolded] = useState<Record<string, boolean>>(loadFolded);
  const toggle = (g: NavGroupId) =>
    setFolded((f) => {
      const n = { ...f, [g]: !f[g] };
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify(n));
      } catch {
        /* ignore */
      }
      return n;
    });
  const go = (id: (typeof NAV)[number]["id"]) => {
    setTab(id);
    setMobileMenu(false);
  };
  return (
    <>
      {mobileMenu && <div className="scrim" onClick={() => setMobileMenu(false)} aria-hidden="true" />}
      <aside
        className={"sidebar" + (mobileMenu ? " open" : "") + (collapsed ? " rail" : "")}
        aria-label="Primary"
      >
        <div className="sb-top">
          <div className="brand">
            <span className="mark">M</span>
            <span className="brand-name">
              meridian<span className="brand-dot">.</span>
            </span>
          </div>
          <button
            className="icon-btn sb-collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={(collapsed ? "Expand" : "Collapse") + " sidebar ( [ )"}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button
            className="icon-btn sidebar-close"
            aria-label="Close menu"
            onClick={() => setMobileMenu(false)}
          >
            <X size={18} />
          </button>
        </div>

        <button className="workspace" onClick={() => go("people")} title={session.organization}>
          <Avatar name={session.organization} size={30} square />
          <span className="ws-text">
            <b>{session.organization}</b>
            <small>Workspace</small>
          </span>
        </button>

        <button className="sb-search" onClick={() => setPaletteOpen(true)} aria-label="Search or jump to…">
          <Search size={15} />
          <span className="sb-label">Search or jump to…</span>
          <kbd className="sb-label">⌘K</kbd>
        </button>

        <nav className="sb-scroll">
          {NAV_GROUPS.map((g) => {
            const items = NAV.filter((n) => n.group === g.id);
            const isFolded = !!folded[g.id] && !collapsed;
            return (
              <div className="nav-group" key={g.id}>
                <button
                  className="nav-caption"
                  onClick={() => toggle(g.id)}
                  aria-expanded={!isFolded}
                  aria-label={`${g.label} section`}
                >
                  <span>{g.label}</span>
                  {isFolded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                {!isFolded &&
                  items.map((n) => (
                    <button
                      key={n.id}
                      className={"nav" + (tab === n.id ? " active" : "")}
                      aria-current={tab === n.id ? "page" : undefined}
                      title={n.label + (n.key ? `  (g then ${n.key})` : "")}
                      onClick={() => go(n.id)}
                    >
                      {n.icon}
                      <span className="sb-label">{n.label}</span>
                    </button>
                  ))}
              </div>
            );
          })}

          <div className="nav-group projects-nav">
            <div className="nav-caption static">
              <span>Projects</span>
              <button
                className="icon-btn"
                aria-label="New project"
                title="New project"
                onClick={() => setModal("project")}
              >
                <Plus size={15} />
              </button>
            </div>
            {projects.map((p) => (
              <button
                key={p.id}
                className={"project-nav" + (p.id === selected ? " selected" : "")}
                aria-current={p.id === selected ? "true" : undefined}
                title={p.name}
                onClick={() => {
                  setSelected(p.id);
                  setActivePage(null);
                  setMobileMenu(false);
                }}
              >
                <span className="project-icon">{p.key.slice(0, 2)}</span>
                <span className="sb-label pn-name">{p.name}</span>
                {p.visibility === "private" && (
                  <Lock size={12} className="sb-label" aria-label="Private project" />
                )}
              </button>
            ))}
            {!projects.length && <div className="muted small pad sb-label">No projects yet</div>}
          </div>
        </nav>

        <div className="sidebar-bottom">
          <button className="profile" onClick={() => go("appearance")} title="Appearance settings">
            <Avatar name={session.name} size={28} />
            <span className="ws-text">
              <b>{session.name}</b>
              <small>{me?.role ?? "Member"}</small>
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
