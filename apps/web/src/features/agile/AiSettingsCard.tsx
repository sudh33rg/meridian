import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";

type AiSettings = { enabled: boolean; configured: boolean; model: string };

/** The workspace's AI opt-in. Turning it on lets summaries and triage send project text to the model. */
export function AiSettingsCard({ token, admin }: { token: string; admin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({
    queryKey: ["ai-settings"],
    queryFn: () => request<AiSettings>(token, "/workspace/ai"),
  });
  const save = useMutation({
    mutationFn: (enabled: boolean) => send<AiSettings>("/workspace/ai", token, "PUT", { enabled, configured: q.data?.configured ?? false, model: q.data?.model ?? "" }),
    onSuccess: (next) => {
      toast(next.enabled ? "AI summaries and triage are on" : "AI summaries and triage are off");
      void qc.invalidateQueries({ queryKey: ["ai-settings"] });
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });
  if (!q.data) return null;
  return (
    <section className="panel" aria-label="AI assistance">
      <h4>AI summaries and triage</h4>
      <p className="muted small">
        When on, an issue's title, description and comments, and the titles of the project's other open issues, are sent to
        the model the server is configured with. Only text you can already see is sent. Nothing the model returns is stored.
      </p>
      {!q.data.configured && <p className="muted small">The server has no AI key, so this cannot be turned on here.</p>}
      <label className="inline-check">
        <input
          type="checkbox"
          checked={q.data.enabled}
          disabled={!admin || !q.data.configured || save.isPending}
          onChange={(e) => save.mutate(e.target.checked)}
        />{" "}
        Allow AI for this workspace ({q.data.model})
      </label>
    </section>
  );
}
