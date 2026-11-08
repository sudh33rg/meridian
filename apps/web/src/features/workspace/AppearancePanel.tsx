import React from "react";
import { Check } from "lucide-react";
import { ACCENTS, useTheme, type Density, type Motion } from "../../lib/theme";
import { MODES } from "../shell/ThemeMenu";

const DENSITIES: { id: Density; label: string; hint: string }[] = [
  { id: "comfortable", label: "Comfortable", hint: "More breathing room" },
  { id: "compact", label: "Compact", hint: "See more rows at once" },
];
const MOTIONS: { id: Motion; label: string }[] = [
  { id: "system", label: "Follow system" },
  { id: "reduce", label: "Reduce motion" },
  { id: "full", label: "Full motion" },
];

export function AppearancePanel() {
  const { appearance, set } = useTheme();
  return (
    <div className="appearance">
      <div className="ext-title">
        <div>
          <h1>Appearance</h1>
          <p>Theme, accent, density and motion. Saved on this device only.</p>
        </div>
      </div>

      <section className="panel-card" aria-labelledby="ap-theme">
        <h3 id="ap-theme">Theme</h3>
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={appearance.mode === m.id}
              className={"theme-card" + (appearance.mode === m.id ? " on" : "")}
              onClick={() => set({ mode: m.id })}
            >
              <span className={"theme-preview tp-" + m.id} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="theme-card-label">
                {m.icon} {m.label}
                {appearance.mode === m.id && <Check size={14} />}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel-card" aria-labelledby="ap-accent">
        <h3 id="ap-accent">Accent color</h3>
        <div className="swatches big" role="radiogroup" aria-label="Accent color">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              role="radio"
              aria-checked={appearance.accent === a.id}
              className={"swatch" + (appearance.accent === a.id ? " on" : "")}
              style={{ background: a.swatch }}
              onClick={() => set({ accent: a.id })}
              title={a.label}
            >
              <span className="sr-only">{a.label}</span>
              {appearance.accent === a.id && <Check size={16} color="#fff" />}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-card" aria-labelledby="ap-density">
        <h3 id="ap-density">Density</h3>
        <div className="seg" role="radiogroup" aria-label="Density">
          {DENSITIES.map((d) => (
            <button
              key={d.id}
              role="radio"
              aria-checked={appearance.density === d.id}
              className={appearance.density === d.id ? "on" : ""}
              onClick={() => set({ density: d.id })}
            >
              <b>{d.label}</b>
              <small>{d.hint}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="panel-card" aria-labelledby="ap-motion">
        <h3 id="ap-motion">Motion</h3>
        <div className="seg" role="radiogroup" aria-label="Motion">
          {MOTIONS.map((d) => (
            <button
              key={d.id}
              role="radio"
              aria-checked={appearance.motion === d.id}
              className={appearance.motion === d.id ? "on" : ""}
              onClick={() => set({ motion: d.id })}
            >
              <b>{d.label}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="panel-card preview-card" aria-label="Preview">
        <h3>Preview</h3>
        <div className="preview-row">
          <button className="primary">Primary action</button>
          <button className="secondary">Secondary</button>
          <span className="status in_progress">In progress</span>
          <span className="status done">Done</span>
          <span className="status in_review">In review</span>
          <span className="chip">Label</span>
        </div>
      </section>
    </div>
  );
}
