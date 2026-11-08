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
    <div className="popover-wrap" ref={ref}>
      <button
        className="icon-btn lg"
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
        <div className="popover" role="menu" aria-label="Theme">
          <div className="popover-title">Theme</div>
          {MODES.map((m) => (
            <button
              key={m.id}
              role="menuitemradio"
              aria-checked={appearance.mode === m.id}
              className="menu-item"
              onClick={() => set({ mode: m.id })}
            >
              {m.icon}
              <span>{m.label}</span>
              {appearance.mode === m.id && <Check size={14} className="menu-check" />}
            </button>
          ))}
          <div className="popover-title">Accent</div>
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                className={"swatch" + (appearance.accent === a.id ? " on" : "")}
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
