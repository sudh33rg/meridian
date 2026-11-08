import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { NAV } from "./nav";

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
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setHelpOpen(false)}>
      <div className="modal shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="modal-head">
          <div>
            <div className="eyebrow blue">KEYBOARD</div>
            <h2>Shortcuts</h2>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => setHelpOpen(false)} autoFocus>
            <X size={20} />
          </button>
        </div>
        <div className="shortcut-list">
          {ROWS.map(([label, keys]) => (
            <div className="shortcut-row" key={label}>
              <span>{label}</span>
              <span className="keys">
                {keys.map((k, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="then">then</span>}
                    <kbd>{k}</kbd>
                  </React.Fragment>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
