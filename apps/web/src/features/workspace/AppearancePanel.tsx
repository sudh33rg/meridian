import React from "react";
import { Check } from "lucide-react";
import { ACCENTS, useTheme, type Density, type Motion } from "../../lib/theme";
import { MODES } from "../shell/ThemeMenu";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

const DENSITIES: { id: Density; label: string; hint: string }[] = [
  { id: "comfortable", label: "Comfortable", hint: "More breathing room and larger touch targets" },
  { id: "compact", label: "Compact", hint: "Dense view to see more rows and details at once" },
];

const MOTIONS: { id: Motion; label: string }[] = [
  { id: "system", label: "Follow system" },
  { id: "reduce", label: "Reduce motion" },
  { id: "full", label: "Full motion" },
];

export function AppearancePanel() {
  const { appearance, set } = useTheme();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-text-main m-0">Appearance & Theme</h2>
        <p className="text-xs sm:text-sm text-text-muted mt-1 m-0">
          Customize your visual interface, color accents, density scale and animations. Preferences persist on
          this device.
        </p>
      </div>

      {/* Theme Mode Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Interface Theme</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="radiogroup" aria-label="Theme">
            {MODES.map((m) => {
              const isSelected = appearance.mode === m.id;
              return (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => set({ mode: m.id })}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                    isSelected
                      ? "border-accent ring-2 ring-accent-ring bg-accent-soft text-accent"
                      : "border-border bg-surface hover:border-border-strong text-text-main"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`p-2 rounded-lg ${isSelected ? "bg-accent text-on-accent" : "bg-surface-3 text-text-muted"}`}
                    >
                      {m.icon}
                    </span>
                    {isSelected && <Check size={16} className="text-accent" />}
                  </div>
                  <div>
                    <div className="text-xs sm:text-sm font-bold text-text-main">{m.label}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Accent Color Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Brand Accent Color</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label="Accent color">
            {ACCENTS.map((a) => {
              const isSelected = appearance.accent === a.id;
              return (
                <button
                  key={a.id}
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => set({ accent: a.id })}
                  title={a.label}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-xs ${
                    isSelected ? "ring-4 ring-offset-2 ring-accent scale-110" : "hover:scale-105"
                  }`}
                  style={{ background: a.swatch }}
                >
                  <span className="sr-only">{a.label}</span>
                  {isSelected && <Check size={18} color="#fff" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Density Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Row & UI Density</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Density">
            {DENSITIES.map((d) => {
              const isSelected = appearance.density === d.id;
              return (
                <button
                  key={d.id}
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => set({ density: d.id })}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? "border-accent ring-2 ring-accent-ring bg-accent-soft text-accent"
                      : "border-border bg-surface hover:border-border-strong text-text-main"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-text-main">{d.label}</span>
                    {isSelected && <Check size={16} className="text-accent" />}
                  </div>
                  <p className="text-xs text-text-muted m-0">{d.hint}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Motion Setting */}
      <Card>
        <CardHeader>
          <CardTitle>Animations & Motion</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Motion">
            {MOTIONS.map((d) => {
              const isSelected = appearance.motion === d.id;
              return (
                <button
                  key={d.id}
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => set({ motion: d.id })}
                  className={`p-3.5 rounded-xl border text-center transition-all cursor-pointer ${
                    isSelected
                      ? "border-accent ring-2 ring-accent-ring bg-accent-soft text-accent font-bold"
                      : "border-border bg-surface text-text-muted hover:border-border-strong hover:text-text-main"
                  }`}
                >
                  <span className="text-xs sm:text-sm">{d.label}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Component Visual Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Live Preview</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <button className="px-4 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-strong shadow-xs transition-colors">
              Primary Action
            </button>
            <button className="px-4 py-2 rounded-lg text-xs font-semibold border border-border bg-surface-2 text-text-main hover:bg-surface-3 transition-colors">
              Secondary Button
            </button>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-info-soft text-info-text border border-info/30">
              <span className="w-1.5 h-1.5 rounded-full bg-info" /> In progress
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-success-soft text-success-text border border-success/30">
              <span className="w-1.5 h-1.5 rounded-full bg-success" /> Done
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-warning-soft text-warning-text border border-warning/30">
              <span className="w-1.5 h-1.5 rounded-full bg-warning" /> In review
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
