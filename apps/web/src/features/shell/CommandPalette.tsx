import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CornerDownLeft,
  FileText,
  FolderKanban,
  ListPlus,
  LogOut,
  Moon,
  Palette,
  PanelLeft,
  Search,
  Sun,
} from "lucide-react";
import { useWorkspace } from "../workspace/useWorkspace";
import { useTheme } from "../../lib/theme";
import { NAV } from "./nav";

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ReactNode;
  keywords?: string;
  run: () => void;
};

/** Subsequence fuzzy score: higher is better, -1 means no match. */
export function fuzzy(q: string, text: string): number {
  if (!q) return 0;
  const t = text.toLowerCase();
  const query = q.toLowerCase();
  const at = t.indexOf(query);
  if (at >= 0) return 100 - at - (t.length - query.length) * 0.1;
  let qi = 0;
  let score = 0;
  let last = -2;
  for (let i = 0; i < t.length && qi < query.length; i++) {
    if (t[i] === query[qi]) {
      score += last === i - 1 ? 3 : 1;
      last = i;
      qi++;
    }
  }
  return qi === query.length ? score : -1;
}

const RECENT_KEY = "meridian.recent.cmds";
const loadRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
};

export function CommandPalette() {
  const ws = useWorkspace();
  const { appearance, set, cycleMode } = useTheme();
  const {
    paletteOpen,
    setPaletteOpen,
    issues,
    project,
    projects,
    setTab,
    setSelected,
    setSelectedIssue,
    setModal,
    logout,
  } = ws;
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setPaletteOpen(false);
    setQ("");
    setActive(0);
  };

  const commands = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [];
    if (project) {
      list.push(
        {
          id: "c-issue",
          label: "Create issue",
          group: "Create",
          icon: <ListPlus size={16} />,
          hint: "C",
          keywords: "new add task bug",
          run: () => setModal("issue"),
        },
        {
          id: "c-page",
          label: "Create page",
          group: "Create",
          icon: <FileText size={16} />,
          keywords: "new doc knowledge",
          run: () => setModal("page"),
        },
      );
    }
    list.push({
      id: "c-project",
      label: "Create project",
      group: "Create",
      icon: <FolderKanban size={16} />,
      keywords: "new",
      run: () => setModal("project"),
    });
    for (const n of NAV) {
      list.push({
        id: "go-" + n.id,
        label: "Go to " + n.label,
        group: "Navigate",
        icon: n.icon,
        hint: n.key ? `G ${n.key.toUpperCase()}` : undefined,
        keywords: n.keywords,
        run: () => setTab(n.id),
      });
    }
    for (const p of projects) {
      list.push({
        id: "p-" + p.id,
        label: "Switch to " + p.name,
        group: "Projects",
        icon: <span className="project-icon sm">{p.key.slice(0, 2)}</span>,
        keywords: p.key,
        run: () => setSelected(p.id),
      });
    }
    list.push(
      {
        id: "t-cycle",
        label: "Cycle theme (system / light / dark / contrast)",
        group: "Appearance",
        icon: <Palette size={16} />,
        keywords: "mode",
        run: cycleMode,
      },
      {
        id: "t-light",
        label: "Theme: Light",
        group: "Appearance",
        icon: <Sun size={16} />,
        run: () => set({ mode: "light" }),
      },
      {
        id: "t-dark",
        label: "Theme: Dark",
        group: "Appearance",
        icon: <Moon size={16} />,
        run: () => set({ mode: "dark" }),
      },
      {
        id: "t-density",
        label: appearance.density === "compact" ? "Density: Comfortable" : "Density: Compact",
        group: "Appearance",
        icon: <PanelLeft size={16} />,
        run: () => set({ density: appearance.density === "compact" ? "comfortable" : "compact" }),
      },
      {
        id: "x-help",
        label: "Keyboard shortcuts",
        group: "Help",
        icon: <kbd className="kbd-icon">?</kbd>,
        hint: "?",
        run: () => ws.setHelpOpen(true),
      },
      {
        id: "x-out",
        label: "Sign out",
        group: "Account",
        icon: <LogOut size={16} />,
        run: () => void logout(),
      },
    );
    for (const i of issues.slice(0, 200)) {
      list.push({
        id: "i-" + i.id,
        label: `${project?.key ?? ""}-${i.number} ${i.title}`,
        group: "Issues",
        icon: <Search size={16} />,
        keywords: i.kind + " " + i.status,
        run: () => {
          setTab("issues");
          setSelectedIssue(i.id);
        },
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, projects, issues, appearance.density]);

  const results = useMemo(() => {
    if (!q.trim()) {
      const recent = loadRecent();
      const rec = recent.map((id) => commands.find((c) => c.id === id)).filter(Boolean) as Cmd[];
      const base = commands.filter((c) => c.group !== "Issues" && !recent.includes(c.id));
      return [...rec.map((c) => ({ ...c, group: "Recent" })), ...base];
    }
    return commands
      .map((c) => ({ c, s: Math.max(fuzzy(q, c.label), fuzzy(q, c.keywords ?? "") - 20) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c);
  }, [q, commands]);

  useEffect(() => {
    if (paletteOpen) setTimeout(() => inputRef.current?.focus(), 0);
  }, [paletteOpen]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!paletteOpen) return null;
  const run = (c: Cmd | undefined) => {
    if (!c) return;
    try {
      const prev = loadRecent().filter((x) => x !== c.id);
      localStorage.setItem(RECENT_KEY, JSON.stringify([c.id, ...prev].slice(0, 4)));
    } catch {
      /* ignore */
    }
    close();
    c.run();
  };
  let lastGroup = "";
  return (
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Search size={17} />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? "pal-" + results[active].id : undefined}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command, page, project or issue…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(results[active]);
              } else if (e.key === "Escape") {
                close();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.map((c, idx) => {
            const head = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <React.Fragment key={c.id + idx}>
                {head && !q.trim() && <div className="palette-group">{c.group}</div>}
                <div
                  id={"pal-" + c.id}
                  role="option"
                  aria-selected={idx === active}
                  className={"palette-item" + (idx === active ? " active" : "")}
                  onMouseMove={() => setActive(idx)}
                  onClick={() => run(c)}
                >
                  <span className="pi-icon">{c.icon}</span>
                  <span className="pi-label">{c.label}</span>
                  {q.trim() && <span className="pi-group">{c.group}</span>}
                  {c.hint && <kbd>{c.hint}</kbd>}
                </div>
              </React.Fragment>
            );
          })}
          {!results.length && <div className="palette-empty">No results for “{q}”</div>}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={10} />
            </kbd>{" "}
            select
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
