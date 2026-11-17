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
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "../workspace/useWorkspace";
import { request } from "../../lib/api";
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

  const brandQ = useQuery({
    queryKey: ["workspace-brand"],
    queryFn: () =>
      request<{ brand_name?: string | null; brand_color?: string | null }>(
        session.token,
        "/workspace/settings",
      ),
    staleTime: 60_000,
  });

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

  const wsName = brandQ.data?.brand_name || session.organization;

  return (
    <>
      {/* Mobile Backdrop Scrim */}
      {mobileMenu && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 md:hidden transition-opacity"
          onClick={() => setMobileMenu(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        aria-label="Primary"
        className={`fixed inset-y-0 left-0 z-50 md:static md:z-auto bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-all duration-200 ease-in-out shrink-0 ${
          mobileMenu ? "translate-x-0 w-72 max-w-[85vw] shadow-2xl" : "-translate-x-full md:translate-x-0"
        } ${collapsed ? "md:w-20" : "md:w-64"}`}
      >
        {/* Top Header */}
        <div className="h-16 px-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-display font-extrabold text-base text-white shadow-xs shrink-0 -rotate-3">
              M
            </div>
            {!collapsed && (
              <span className="font-display font-black text-xl tracking-tight text-slate-900 dark:text-white truncate">
                meridian<span className="text-indigo-600 dark:text-indigo-400">.</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Collapse toggle (Desktop) */}
            <button
              className="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={(collapsed ? "Expand" : "Collapse") + " sidebar ( [ )"}
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
            {/* Close button (Mobile) */}
            <button
              className="flex md:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close menu"
              onClick={() => setMobileMenu(false)}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Workspace Card */}
        <div className="p-3 border-b border-slate-100 dark:border-slate-800/80 shrink-0">
          <button
            onClick={() => go("people")}
            title={wsName}
            className={`w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer text-left ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <Avatar name={wsName} size={28} square />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{wsName}</div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">Workspace</div>
              </div>
            )}
          </button>
        </div>

        {/* Search / Command trigger */}
        {!collapsed && (
          <div className="px-3 pt-2 shrink-0">
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Search or jump to…"
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-100/80 dark:bg-slate-800/80 hover:bg-slate-200/70 dark:hover:bg-slate-750 text-slate-500 dark:text-slate-400 text-xs transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2 truncate">
                <Search size={14} className="shrink-0" />
                <span className="truncate">Search or jump to…</span>
              </span>
              <kbd className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300">
                ⌘K
              </kbd>
            </button>
          </div>
        )}

        {/* Scrollable Nav Items */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {NAV_GROUPS.map((g) => {
            const items = NAV.filter((n) => n.group === g.id);
            const isFolded = !!folded[g.id] && !collapsed;
            return (
              <div key={g.id} className="space-y-1">
                {!collapsed && (
                  <button
                    onClick={() => toggle(g.id)}
                    aria-expanded={!isFolded}
                    aria-label={`${g.label} section`}
                    className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
                  >
                    <span>{g.label}</span>
                    {isFolded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>
                )}
                {!isFolded && (
                  <div className="space-y-0.5">
                    {items.map((n) => {
                      const isActive = tab === n.id;
                      return (
                        <button
                          key={n.id}
                          onClick={() => go(n.id)}
                          aria-current={isActive ? "page" : undefined}
                          title={n.label + (n.key ? ` (g then ${n.key})` : "")}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                            collapsed ? "justify-center" : ""
                          } ${
                            isActive
                              ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold shadow-2xs"
                              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-white"
                          }`}
                        >
                          <span
                            className={`shrink-0 ${isActive ? "text-indigo-600 dark:text-indigo-400" : ""}`}
                          >
                            {n.icon}
                          </span>
                          {!collapsed && <span className="truncate">{n.label}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Projects Nav */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1">
            {!collapsed && (
              <div className="flex items-center justify-between px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <span>Projects</span>
                <button
                  aria-label="New project"
                  title="New project"
                  onClick={() => setModal("project")}
                  className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
            <div className="space-y-0.5">
              {projects.map((p) => {
                const isSel = p.id === selected;
                return (
                  <button
                    key={p.id}
                    title={p.name}
                    aria-current={isSel ? "true" : undefined}
                    onClick={() => {
                      setSelected(p.id);
                      setActivePage(null);
                      setMobileMenu(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      collapsed ? "justify-center" : ""
                    } ${
                      isSel
                        ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold"
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <span className="w-5 h-5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold flex items-center justify-center shrink-0 uppercase">
                      {p.key.slice(0, 2)}
                    </span>
                    {!collapsed && <span className="truncate flex-1 text-left">{p.name}</span>}
                    {!collapsed && p.visibility === "private" && (
                      <Lock size={12} className="text-slate-400 shrink-0" aria-label="Private project" />
                    )}
                  </button>
                );
              })}
              {!projects.length && !collapsed && (
                <div className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500 italic">
                  No projects yet
                </div>
              )}
            </div>
          </div>
        </nav>

        {/* Bottom Profile Footer */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800/80 shrink-0">
          <button
            onClick={() => go("appearance")}
            title="Appearance settings"
            className={`w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer text-left ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <Avatar name={session.name} size={28} />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {session.name}
                </div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate capitalize">
                  {me?.role ?? "Member"}
                </div>
              </div>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
