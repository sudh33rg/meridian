import React from "react";
import { useWorkspace } from "../workspace/useWorkspace";
import { BOTTOM_TABS, NAV_BY_ID } from "./nav";

/** Thumb-reach tab bar, shown only on narrow screens (CSS). */
export function BottomNav({ onMore, moreIcon }: { onMore: () => void; moreIcon: React.ReactNode }) {
  const { tab, setTab } = useWorkspace();
  return (
    <nav className="bottom-nav" aria-label="Quick navigation">
      {BOTTOM_TABS.map((id) => {
        const n = NAV_BY_ID[id];
        return (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {n.icon}
            <span>{n.label}</span>
          </button>
        );
      })}
      <button onClick={onMore} aria-label="More">
        {moreIcon}
        <span>More</span>
      </button>
    </nav>
  );
}
