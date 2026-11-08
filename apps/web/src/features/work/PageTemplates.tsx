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
      send<PageTemplate>(`/projects/${projectId}/page-templates`, token, "POST", { name: name.trim(), body: content }),
    onSuccess: () => {
      setName("");
      toast("Template saved");
      void qc.invalidateQueries({ queryKey: ["page-templates", projectId] });
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });

  return (
    <div className="page-templates">
      <label>
        Start from a template
        <select
          value=""
          aria-label="Page template"
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
      <div className="inline-form">
        <input
          aria-label="Template name"
          value={name}
          maxLength={80}
          placeholder="Save this content as a template…"
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="secondary"
          disabled={!name.trim() || !content.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          Save as template
        </button>
      </div>
    </div>
  );
}
