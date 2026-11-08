import React, { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  FileText,
  FolderKanban,
  ListPlus,
  LogOut,
  Menu,
  Palette,
  Plus,
  Search,
} from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { Avatar } from "../shared/Avatar";
import { NAV_BY_ID } from "./nav";
import { ThemeMenu } from "./ThemeMenu";

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, close]);
  return ref;
}

export function Topbar() {
  const { session, me, project, tab, setTab, setModal, setMobileMenu, setPaletteOpen, setHelpOpen, logout } =
    useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const createRef = useDismiss(createOpen, () => setCreateOpen(false));
  const userRef = useDismiss(userOpen, () => setUserOpen(false));
  const pageLabel = NAV_BY_ID[tab]?.label ?? "Overview";
  return (
    <header className="topbar">
      <div className="breadcrumbs">
        <button
          className="icon-btn lg mobile-trigger"
          aria-label="Open menu"
          onClick={() => setMobileMenu(true)}
        >
          <Menu size={19} />
        </button>
        <nav aria-label="Breadcrumb" className="crumbs">
          <button className="crumb" onClick={() => setTab("overview")}>
            {session.organization}
          </button>
          {project && (
            <>
              <ChevronRight size={13} className="slash" />
              <span className="crumb static">{project.name}</span>
            </>
          )}
          <ChevronRight size={13} className="slash" />
          <span className="crumb current" aria-current="page">
            {pageLabel}
          </span>
        </nav>
      </div>

      <button className="cmdk-trigger" onClick={() => setPaletteOpen(true)} aria-label="Open command palette">
        <Search size={15} />
        <span>Search or run a command…</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="top-actions">
        <button className="icon-btn lg only-mobile" aria-label="Search" onClick={() => setPaletteOpen(true)}>
          <Search size={18} />
        </button>
        <div className="popover-wrap" ref={createRef}>
          <button
            className="primary create-btn"
            aria-haspopup="menu"
            aria-expanded={createOpen}
            onClick={() => setCreateOpen((o) => !o)}
          >
            <Plus size={16} /> <span className="hide-sm">Create</span>
          </button>
          {createOpen && (
            <div className="popover right" role="menu" aria-label="Create">
              <button
                role="menuitem"
                className="menu-item"
                disabled={!project}
                onClick={() => {
                  setCreateOpen(false);
                  setModal("issue");
                }}
              >
                <ListPlus size={15} /> <span>New issue</span>
                <kbd>C</kbd>
              </button>
              <button
                role="menuitem"
                className="menu-item"
                disabled={!project}
                onClick={() => {
                  setCreateOpen(false);
                  setModal("page");
                }}
              >
                <FileText size={15} /> <span>New page</span>
              </button>
              <button
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setCreateOpen(false);
                  setModal("project");
                }}
              >
                <FolderKanban size={15} /> <span>New project</span>
              </button>
            </div>
          )}
        </div>
        <button
          className="icon-btn lg hide-sm"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={() => setHelpOpen(true)}
        >
          <kbd className="kbd-icon">?</kbd>
        </button>
        <ThemeMenu />
        <div className="popover-wrap" ref={userRef}>
          <button
            className="avatar-btn"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={userOpen}
            onClick={() => setUserOpen((o) => !o)}
          >
            <Avatar name={session.name} size={30} />
          </button>
          {userOpen && (
            <div className="popover right" role="menu" aria-label="Account">
              <div className="popover-user">
                <Avatar name={session.name} size={36} />
                <span>
                  <b>{session.name}</b>
                  <small>{me?.email}</small>
                </span>
              </div>
              <button
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setUserOpen(false);
                  setTab("appearance");
                }}
              >
                <Palette size={15} /> <span>Appearance</span>
              </button>
              <button role="menuitem" className="menu-item danger" onClick={logout}>
                <LogOut size={15} /> <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
