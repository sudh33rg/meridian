import React, { useEffect, useRef, useState } from "react";
import { Check, Contrast, Laptop, Moon, Sun } from "lucide-react";
import { ACCENTS, useTheme, type Mode } from "../../lib/theme";

export const MODES: { id: Mode; label: string; icon: React.ReactNode }[] = [
  { id: "system", label: "System", icon: <Laptop size={15} /> },
  { id: "light", label: "Light", icon: <Sun size={15} /> },
  { id: "dark", label: "Dark", icon: <Moon size={15} /> },
  { id: "contrast", label: "High contrast", icon: <Contrast size={15} /> },
];

/** Quick theme popover in the top bar. Full options live in the Appearance page. */
export function ThemeMenu() {
  const { appearance, set, resolved } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-3 transition-colors cursor-pointer"
        aria-label="Change theme"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Theme"
        onClick={() => setOpen((o) => !o)}
      >
        {resolved === "light" ? (
          <Sun size={17} />
        ) : resolved === "dark" ? (
          <Moon size={17} />
        ) : (
          <Contrast size={17} />
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-56 bg-surface rounded-xl shadow-xl border border-border p-2 z-50 animate-fadeIn text-text-main"
          role="menu"
          aria-label="Theme"
        >
          <div className="px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-text-subtle">
            Theme
          </div>
          <div className="space-y-0.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="menuitemradio"
                aria-checked={appearance.mode === m.id}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  appearance.mode === m.id
                    ? "bg-accent-soft text-accent font-bold"
                    : "text-text-main hover:bg-surface-3"
                }`}
                onClick={() => set({ mode: m.id })}
              >
                <div className="flex items-center gap-2">
                  {m.icon}
                  <span>{m.label}</span>
                </div>
                {appearance.mode === m.id && <Check size={14} className="text-accent" />}
              </button>
            ))}
          </div>

          <div className="my-2 border-t border-border" />

          <div className="px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-text-subtle">
            Accent Color
          </div>
          <div className="flex items-center justify-between p-2">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                className={`w-6 h-6 rounded-full transition-transform cursor-pointer relative ${
                  appearance.accent === a.id
                    ? "ring-2 ring-offset-2 ring-accent scale-110"
                    : "hover:scale-105"
                }`}
                style={{ background: a.swatch }}
                aria-label={a.label + " accent"}
                aria-pressed={appearance.accent === a.id}
                title={a.label}
                onClick={() => set({ accent: a.id })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
