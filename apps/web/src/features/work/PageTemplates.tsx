import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";

type PageTemplate = { id: string; name: string; body: string; created_at: string };

/** Starts a new page from a saved template, or saves the current page text as a new template. */
export function PageTemplates({
  token,
  projectId,
  content,
  onApply,
}: {
  token: string;
  projectId: string;
  content: string;
  onApply: (body: string) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const templatesQ = useQuery({
    queryKey: ["page-templates", projectId],
    queryFn: () => request<PageTemplate[]>(token, `/projects/${projectId}/page-templates`),
    enabled: !!projectId,
  });
  const templates = templatesQ.data ?? [];
  const save = useMutation({
    mutationFn: () =>
      send<PageTemplate>(`/projects/${projectId}/page-templates`, token, "POST", {
        name: name.trim(),
        body: content,
      }),
    onSuccess: () => {
      setName("");
      toast("Template saved");
      void qc.invalidateQueries({ queryKey: ["page-templates", projectId] });
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });

  return (
    <div className="page-templates space-y-3 p-3 bg-surface-2 rounded-xl border border-border">
      <label className="block text-xs font-medium text-text space-y-1">
        <span>Start from a template</span>
        <select
          value=""
          aria-label="Page template"
          className="w-full px-3 py-1.5 rounded-lg border border-border bg-surface text-text text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value);
            if (t) onApply(t.body);
          }}
        >
          <option value="">{templates.length ? "Choose a template…" : "No templates yet"}</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <div className="inline-form flex items-center gap-2">
        <input
          aria-label="Template name"
          value={name}
          maxLength={80}
          className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-surface text-text text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
          placeholder="Save this content as a template…"
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50 shrink-0 inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
          disabled={!name.trim() || !content.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          Save as template
        </button>
      </div>
    </div>
  );
}
