import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Mode = "system" | "light" | "dark" | "contrast";
export type Accent = "blue" | "violet" | "teal" | "green" | "orange" | "rose";
export type Density = "comfortable" | "compact";
export type Motion = "system" | "reduce" | "full";

export type Appearance = { mode: Mode; accent: Accent; density: Density; motion: Motion };

export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: "blue", label: "Blue", swatch: "hsl(224 78% 55%)" },
  { id: "violet", label: "Violet", swatch: "hsl(258 70% 58%)" },
  { id: "teal", label: "Teal", swatch: "hsl(175 72% 38%)" },
  { id: "green", label: "Green", swatch: "hsl(146 56% 40%)" },
  { id: "orange", label: "Orange", swatch: "hsl(24 88% 52%)" },
  { id: "rose", label: "Rose", swatch: "hsl(342 78% 56%)" },
];

const KEY = "meridian.appearance";
const DEFAULTS: Appearance = { mode: "system", accent: "blue", density: "comfortable", motion: "system" };

function load(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return DEFAULTS;
  }
}

const prefersDark = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

function apply(a: Appearance) {
  const r = document.documentElement;
  const theme = a.mode === "system" ? (prefersDark() ? "dark" : "light") : a.mode;
  r.setAttribute("data-theme", theme);
  r.setAttribute("data-accent", a.accent);
  r.setAttribute("data-density", a.density);
  if (a.motion === "system") r.removeAttribute("data-motion");
  else r.setAttribute("data-motion", a.motion);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#ffffff" : "#0d1117");
}

type Ctx = {
  appearance: Appearance;
  set: (patch: Partial<Appearance>) => void;
  /** Resolved light/dark/contrast actually in effect. */
  resolved: "light" | "dark" | "contrast";
  cycleMode: () => void;
};
const ThemeCtx = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(load);
  const [, force] = useState(0);

  useEffect(() => {
    apply(appearance);
    try {
      localStorage.setItem(KEY, JSON.stringify(appearance));
    } catch {
      /* private mode: keep in memory only */
    }
  }, [appearance]);

  // Follow the OS while mode is "system".
  useEffect(() => {
    if (appearance.mode !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => {
      apply(appearance);
      force((n) => n + 1);
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [appearance]);

  const set = useCallback((patch: Partial<Appearance>) => setAppearance((a) => ({ ...a, ...patch })), []);
  const cycleMode = useCallback(
    () =>
      setAppearance((a) => {
        const order: Mode[] = ["system", "light", "dark", "contrast"];
        return { ...a, mode: order[(order.indexOf(a.mode) + 1) % order.length] };
      }),
    [],
  );
  const resolved = (
    appearance.mode === "system" ? (prefersDark() ? "dark" : "light") : appearance.mode
  ) as Ctx["resolved"];
  const value = useMemo(
    () => ({ appearance, set, resolved, cycleMode }),
    [appearance, set, resolved, cycleMode],
  );
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error("useTheme must be used inside <ThemeProvider>");
  return v;
}
