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
    <header className="h-16 border-b border-border bg-surface/85 backdrop-blur-md px-3 sm:px-6 flex items-center justify-between gap-3 sticky top-0 z-30 shrink-0">
      {/* Left: Hamburger (Mobile) + Breadcrumbs */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          className="p-2 -ml-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-3 transition-colors md:hidden cursor-pointer"
          aria-label="Open menu"
          onClick={() => setMobileMenu(true)}
        >
          <Menu size={20} />
        </button>

        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 text-xs sm:text-sm text-text-muted font-medium truncate"
        >
          <button
            className="hover:text-text-main transition-colors cursor-pointer truncate max-w-[100px] sm:max-w-[150px]"
            onClick={() => setTab("overview")}
          >
            {session.organization}
          </button>
          {project && (
            <>
              <ChevronRight size={14} className="text-text-subtle shrink-0" />
              <span className="text-text-main font-semibold truncate max-w-[120px] sm:max-w-[180px]">
                {project.name}
              </span>
            </>
          )}
          <ChevronRight size={14} className="text-text-subtle shrink-0" />
          <span className="text-accent font-bold truncate" aria-current="page">
            {pageLabel}
          </span>
        </nav>
      </div>

      {/* Middle: Command Search Trigger (Desktop) */}
      <button
        className="hidden md:flex items-center justify-between gap-4 px-3.5 py-1.5 rounded-xl bg-surface-2 hover:bg-surface-3 text-text-muted text-xs w-64 lg:w-80 border border-border transition-colors cursor-pointer"
        onClick={() => setPaletteOpen(true)}
        aria-label="Open command palette"
      >
        <div className="flex items-center gap-2 truncate">
          <Search size={14} className="shrink-0" />
          <span className="truncate">Search or jump to…</span>
        </div>
        <kbd className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface border border-border text-text-muted shadow-2xs">
          ⌘K
        </kbd>
      </button>

      {/* Right Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Search icon (Mobile only) */}
        <button
          className="flex md:hidden p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-3 transition-colors cursor-pointer"
          aria-label="Search"
          onClick={() => setPaletteOpen(true)}
        >
          <Search size={19} />
        </button>

        {/* Create Button Popover */}
        <div className="relative" ref={createRef}>
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold text-white bg-accent hover:bg-accent-strong active:bg-accent-strong shadow-xs transition-colors cursor-pointer"
            aria-haspopup="menu"
            aria-expanded={createOpen}
            onClick={() => setCreateOpen((o) => !o)}
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Create</span>
          </button>

          {createOpen && (
            <div
              className="absolute right-0 mt-2 w-48 bg-surface rounded-xl shadow-xl border border-border p-1.5 z-50 animate-fadeIn"
              role="menu"
              aria-label="Create"
            >
              <button
                role="menuitem"
                disabled={!project}
                onClick={() => {
                  setCreateOpen(false);
                  setModal("issue");
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold text-text-main hover:bg-surface-3 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <ListPlus size={15} className="text-accent" />
                  <span>New issue</span>
                </div>
                <kbd className="text-[10px] text-text-muted">C</kbd>
              </button>

              <button
                role="menuitem"
                disabled={!project}
                onClick={() => {
                  setCreateOpen(false);
                  setModal("page");
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-text-main hover:bg-surface-3 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <FileText size={15} className="text-success" />
                <span>New page</span>
              </button>

              <button
                role="menuitem"
                onClick={() => {
                  setCreateOpen(false);
                  setModal("project");
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-text-main hover:bg-surface-3 transition-colors cursor-pointer"
              >
                <FolderKanban size={15} className="text-warning" />
                <span>New project</span>
              </button>
            </div>
          )}
        </div>

        {/* Shortcuts (?) trigger (Desktop) */}
        <button
          className="hidden lg:flex items-center justify-center w-8 h-8 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-3 text-xs font-bold transition-colors cursor-pointer"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={() => setHelpOpen(true)}
        >
          ?
        </button>

        {/* Theme Switcher Menu */}
        <ThemeMenu />

        {/* User Account Popover */}
        <div className="relative" ref={userRef}>
          <button
            className="p-0.5 rounded-full ring-2 ring-transparent hover:ring-accent-ring transition-all cursor-pointer flex items-center"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={userOpen}
            onClick={() => setUserOpen((o) => !o)}
          >
            <Avatar name={session.name} size={30} />
          </button>

          {userOpen && (
            <div
              className="absolute right-0 mt-2 w-56 bg-surface rounded-xl shadow-xl border border-border p-2 z-50 animate-fadeIn"
              role="menu"
              aria-label="Account"
            >
              <div className="px-3 py-2.5 border-b border-border mb-1 flex items-center gap-2.5">
                <Avatar name={session.name} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-text-main truncate">{session.name}</div>
                  <div className="text-[11px] text-text-muted truncate">{me?.email}</div>
                </div>
              </div>

              <button
                role="menuitem"
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-text-main hover:bg-surface-3 transition-colors cursor-pointer"
                onClick={() => {
                  setUserOpen(false);
                  setTab("appearance");
                }}
              >
                <Palette size={15} />
                <span>Appearance</span>
              </button>

              <div className="my-1 border-t border-border" />

              <button
                role="menuitem"
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-danger hover:bg-danger-soft transition-colors cursor-pointer"
                onClick={logout}
              >
                <LogOut size={15} />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
