import React, { useState } from "react";
import { AiSettingsCard } from "./AiSettingsCard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "../workspace/useWorkspace";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { Settings2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

type Settings = {
  timezone: string;
  working_days: number[];
  week_start: number;
  default_sprint_days: number;
  locale: string;
  trash_retention_days: number;
  brand_name?: string | null;
  brand_color?: string | null;
  attachment_retention_days?: number | null;
  custom_domain?: string | null;
  logo_url?: string | null;
};

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

/** Workspace-wide defaults: time zone, working days, week start and sprint length. Admins edit them. */
export function WorkspaceSettingsPanel() {
  const { session, setError, me } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["workspace-settings"],
    queryFn: () => request<Settings>(session.token, "/workspace/settings"),
  });
  const [draft, setDraft] = useState<Settings | null>(null);
  const current = draft ?? settings.data;
  const admin = me?.role === "owner" || me?.role === "admin";
  if (!current) return null;

  return (
    <Card
      className="space-y-5 p-4 sm:p-6 bg-surface border border-border rounded-[var(--radius-lg)] overflow-hidden mb-4 shadow-[var(--shadow-sm)] mt-3 flex flex-col gap-2 [&_h3]:m-0 [&_h3]:flex [&_h3]:items-center [&_h3]:gap-1.5 [&_h3]:text-[13px]"
      aria-labelledby="ws-title"
    >
      <CardHeader className="pb-3 border-b border-border">
        <CardTitle id="ws-title" className="text-base font-bold text-text-main flex items-center gap-2">
          <Settings2 size={18} className="text-accent" /> Workspace settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-2">
        <AiSettingsCard token={session.token} admin={admin} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>Time zone</span>
            <input
              value={current.timezone}
              disabled={!admin}
              maxLength={64}
              onChange={(e) => setDraft({ ...current, timezone: e.target.value })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>Language</span>
            <select
              value={current.locale}
              disabled={!admin}
              onChange={(e) => setDraft({ ...current, locale: e.target.value })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main disabled:opacity-50"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>Trash retention (days)</span>
            <input
              type="number"
              min={7}
              max={365}
              value={current.trash_retention_days}
              disabled={!admin}
              onChange={(e) => setDraft({ ...current, trash_retention_days: Number(e.target.value) })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>Attachment retention (days, 0 = keep forever)</span>
            <input
              type="number"
              min={0}
              max={3650}
              value={current.attachment_retention_days ?? 0}
              disabled={!admin}
              onChange={(e) =>
                setDraft({ ...current, attachment_retention_days: Number(e.target.value) || null })
              }
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>Custom domain</span>
            <input
              value={current.custom_domain ?? ""}
              disabled={!admin}
              maxLength={120}
              placeholder="tracker.example.com"
              onChange={(e) => setDraft({ ...current, custom_domain: e.target.value || null })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>Logo URL</span>
            <input
              value={current.logo_url ?? ""}
              disabled={!admin}
              maxLength={500}
              placeholder="https://example.com/logo.png"
              onChange={(e) => setDraft({ ...current, logo_url: e.target.value || null })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>Brand name (shown instead of workspace name)</span>
            <input
              value={current.brand_name ?? ""}
              disabled={!admin}
              maxLength={60}
              placeholder="Workspace name"
              onChange={(e) => setDraft({ ...current, brand_name: e.target.value })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>Accent colour</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={current.brand_color || "#3b5bdb"}
                disabled={!admin}
                onChange={(e) => setDraft({ ...current, brand_color: e.target.value })}
                className="w-12 h-9 p-0.5 bg-bg border border-border rounded-xl cursor-pointer disabled:opacity-50"
              />
              {current.brand_color && admin && (
                <button
                  type="button"
                  className="px-2.5 py-1.5 bg-surface-2 hover:bg-surface-3 border border-border rounded-lg text-xs inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[30px] text-text-muted hover:text-text-main"
                  onClick={() => setDraft({ ...current, brand_color: "" })}
                >
                  Use default
                </button>
              )}
            </div>
          </label>
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>Week starts on</span>
            <select
              value={current.week_start}
              disabled={!admin}
              onChange={(e) => setDraft({ ...current, week_start: Number(e.target.value) })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main disabled:opacity-50"
            >
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, n) => (
                <option key={d} value={n}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-xs sm:text-sm font-medium text-text-main">
            <span>Default sprint length (days)</span>
            <input
              type="number"
              min={1}
              max={60}
              value={current.default_sprint_days}
              disabled={!admin}
              onChange={(e) => setDraft({ ...current, default_sprint_days: Number(e.target.value) })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-xl text-xs sm:text-sm text-text-main focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </label>
        </div>

        <fieldset className="p-4 bg-surface-2 rounded-xl border border-border space-y-2 text-[11px]">
          <legend className="text-xs font-bold uppercase tracking-wider text-text-subtle px-1">
            Working days
          </legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(([n, label]) => (
              <label
                key={n}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface border border-border rounded-lg text-xs text-text-main cursor-pointer select-none [&_input[type=checkbox]]:size-3.5 [&_input[type=checkbox]]:min-h-0 [&_input[type=checkbox]]:m-0"
              >
                <input
                  type="checkbox"
                  checked={current.working_days.includes(n)}
                  disabled={!admin}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...current.working_days, n]
                      : current.working_days.filter((d) => d !== n);
                    setDraft({ ...current, working_days: next.sort() });
                  }}
                  className="rounded text-accent focus:ring-accent"
                />{" "}
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {admin ? (
          <button
            className="px-4 py-2 bg-accent hover:bg-accent-strong text-white rounded-xl text-xs sm:text-sm font-medium transition-colors shadow-sm disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[30px]"
            disabled={!draft}
            onClick={async () => {
              if (!draft) return;
              try {
                await send("/workspace/settings", session.token, "PUT", {
                  ...draft,
                  brand_name: draft.brand_name ?? null,
                  brand_color: draft.brand_color ?? null,
                  attachment_retention_days: draft.attachment_retention_days ?? null,
                  custom_domain: draft.custom_domain ?? null,
                  logo_url: draft.logo_url ?? null,
                });
                setDraft(null);
                await qc.invalidateQueries({ queryKey: ["workspace-settings"] });
                await qc.invalidateQueries({ queryKey: ["workspace-brand"] });
                toast("Workspace settings saved");
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Save settings
          </button>
        ) : (
          <p className="text-xs text-text-subtle italic">Only owners and admins can change these.</p>
        )}
      </CardContent>
    </Card>
  );
}
