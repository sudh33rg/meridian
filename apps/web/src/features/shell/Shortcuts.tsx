import React, { useEffect, useRef } from "react";
import { useWorkspace } from "../workspace/useWorkspace";
import { NAV } from "./nav";
import { Modal } from "../shared/UiComponents";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
};

/** Global keyboard layer: ⌘/Ctrl+K palette, `?` help, `c` create, `[` sidebar, `g` then a key to jump. */
export function useGlobalShortcuts() {
  const ws = useWorkspace();
  const ref = useRef(ws);
  ref.current = ws;

  useEffect(() => {
    let gUntil = 0;
    const onKey = (e: KeyboardEvent) => {
      const w = ref.current;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        w.setPaletteOpen(!w.paletteOpen);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || w.paletteOpen || w.modal) return;
      if (e.key === "Escape") {
        w.setHelpOpen(false);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        w.setHelpOpen(!w.helpOpen);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        w.setPaletteOpen(true);
        return;
      }
      if (e.key === "[") {
        w.setCollapsed((c) => !c);
        return;
      }
      if (Date.now() < gUntil) {
        gUntil = 0;
        const hit = NAV.find((n) => n.key === e.key.toLowerCase());
        if (hit) {
          e.preventDefault();
          w.setTab(hit.id);
        }
        return;
      }
      if (e.key.toLowerCase() === "g") {
        gUntil = Date.now() + 1200;
        return;
      }
      if (e.key.toLowerCase() === "c" && w.project) {
        e.preventDefault();
        w.setModal("issue");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

const ROWS: [string, string[]][] = [
  ["Open command palette", ["⌘", "K"]],
  ["Search or jump to", ["/"]],
  ["Create issue", ["C"]],
  ["Toggle sidebar", ["["]],
  ["Show this help", ["?"]],
  ["Go to Overview", ["G", "O"]],
  ["Go to Board", ["G", "B"]],
  ["Go to All work", ["G", "I"]],
  ["Go to Knowledge", ["G", "K"]],
  ["Go to Sprints", ["G", "S"]],
  ["Go to Inbox", ["G", "N"]],
  ["Go to Appearance", ["G", "T"]],
  ["Close dialog or menu", ["Esc"]],
];

export function ShortcutsHelp() {
  const { helpOpen, setHelpOpen } = useWorkspace();
  if (!helpOpen) return null;

  return (
    <Modal
      open={helpOpen}
      onClose={() => setHelpOpen(false)}
      title="Keyboard Shortcuts"
      subtitle="Navigate Meridian with speed using quick keystrokes."
      maxWidth="max-w-md"
    >
      <div className="space-y-2">
        {ROWS.map(([label, keys]) => (
          <div
            key={label}
            className="flex items-center justify-between py-2 px-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-xs sm:text-sm"
          >
            <span className="text-slate-700 dark:text-slate-300 font-medium">{label}</span>
            <span className="flex items-center gap-1 shrink-0">
              {keys.map((k, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="text-[10px] text-slate-400 mx-0.5">then</span>}
                  <kbd className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-2xs">
                    {k}
                  </kbd>
                </React.Fragment>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
