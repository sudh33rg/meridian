import React from "react";
import { useWorkspace } from "../workspace/useWorkspace";
import { BOTTOM_TABS, NAV_BY_ID } from "./nav";

/** Thumb-reach tab bar, shown only on narrow screens (<md). */
export function BottomNav({ onMore, moreIcon }: { onMore: () => void; moreIcon: React.ReactNode }) {
  const { tab, setTab } = useWorkspace();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur-md border-t border-border flex items-center justify-around h-16 md:hidden px-1 shadow-lg text-text-main"
      aria-label="Quick navigation"
    >
      {BOTTOM_TABS.map((id) => {
        const n = NAV_BY_ID[id];
        const isActive = tab === id;
        return (
          <button
            key={id}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 px-1 text-[11px] font-semibold transition-colors cursor-pointer ${
              isActive ? "text-accent font-bold" : "text-text-muted hover:text-text-main"
            }`}
            aria-current={isActive ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <div className={`p-1 rounded-lg mb-0.5 ${isActive ? "bg-accent-soft" : ""}`}>{n.icon}</div>
            <span className="truncate max-w-[64px]">{n.label}</span>
          </button>
        );
      })}
      <button
        onClick={onMore}
        aria-label="More"
        className="flex flex-col items-center justify-center flex-1 h-full py-1 px-1 text-[11px] font-semibold text-text-muted hover:text-text-main transition-colors cursor-pointer"
      >
        <div className="p-1 rounded-lg mb-0.5">{moreIcon}</div>
        <span>More</span>
      </button>
    </nav>
  );
}
