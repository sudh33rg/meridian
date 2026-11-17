import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";
import { Bot } from "lucide-react";

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
    mutationFn: (enabled: boolean) =>
      send<AiSettings>("/workspace/ai", token, "PUT", {
        enabled,
        configured: q.data?.configured ?? false,
        model: q.data?.model ?? "",
      }),
    onSuccess: (next) => {
      toast(next.enabled ? "AI summaries and triage are on" : "AI summaries and triage are off");
      void qc.invalidateQueries({ queryKey: ["ai-settings"] });
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });

  if (!q.data) return null;

  return (
    <Card className="panel" aria-label="AI assistance">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot size={18} className="text-indigo-500" />
          AI summaries and triage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="muted small text-xs sm:text-sm text-muted">
          When on, an issue's title, description and comments, and the titles of the project's other open
          issues, are sent to the model the server is configured with. Only text you can already see is sent.
          Nothing the model returns is stored.
        </p>
        {!q.data.configured && (
          <p className="muted small text-xs text-amber-600 dark:text-amber-400">
            The server has no AI key, so this cannot be turned on here.
          </p>
        )}
        <label className="inline-check flex items-center gap-2.5 text-xs sm:text-sm font-medium text-text cursor-pointer">
          <input
            type="checkbox"
            className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-50"
            checked={q.data.enabled}
            disabled={!admin || !q.data.configured || save.isPending}
            onChange={(e) => save.mutate(e.target.checked)}
          />
          <span>Allow AI for this workspace ({q.data.model})</span>
        </label>
      </CardContent>
    </Card>
  );
}
