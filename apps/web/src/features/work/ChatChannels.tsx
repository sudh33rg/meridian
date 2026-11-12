import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, request, send } from "../../lib/api";
import { useToast } from "../shared/Toast";

type Channels = {
  slack_configured: boolean;
  teams_configured: boolean;
  slack_enabled: boolean;
  teams_enabled: boolean;
  notify_status_changes: boolean;
  notify_new_issues: boolean;
};

/** Slack and Teams posts for a project. Only project admins can see or change it. URLs are never shown back. */
export function ChatChannels({ token, projectId }: { token: string; projectId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [slackUrl, setSlackUrl] = useState("");
  const [teamsUrl, setTeamsUrl] = useState("");
  const channelsQ = useQuery({
    queryKey: ["chat-channels", projectId],
    queryFn: () => request<Channels>(token, `/projects/${projectId}/chat-channels`),
    enabled: !!projectId,
    retry: false,
  });
  const save = useMutation({
    mutationFn: (next: Partial<Channels> & { slack_url?: string; teams_url?: string }) =>
      send<Channels>(`/projects/${projectId}/chat-channels`, token, "PUT", {
        slack_url: next.slack_url,
        teams_url: next.teams_url,
        slack_enabled: next.slack_enabled ?? channelsQ.data?.slack_enabled ?? false,
        teams_enabled: next.teams_enabled ?? channelsQ.data?.teams_enabled ?? false,
        notify_status_changes: next.notify_status_changes ?? channelsQ.data?.notify_status_changes ?? true,
        notify_new_issues: next.notify_new_issues ?? channelsQ.data?.notify_new_issues ?? false,
      }),
    onSuccess: () => {
      setSlackUrl("");
      setTeamsUrl("");
      toast("Chat settings saved");
      void qc.invalidateQueries({ queryKey: ["chat-channels", projectId] });
    },
    onError: (e) => toast(errorMessage(e), { kind: "error" }),
  });
  const data = channelsQ.data;
  if (!data) return null;
  return (
    <section className="workflow" aria-label="Chat notifications">
      <div className="workflow-head">
        <b>Chat notifications</b>
        <span className="muted small">
          Posts an issue key, title, status change and who made it. Never descriptions or comments.
        </span>
      </div>
      <div className="workflow-add">
        <label>
          <span className="muted small">Slack webhook {data.slack_configured ? "(saved)" : "(not set)"}</span>
          <input
            type="password"
            autoComplete="off"
            value={slackUrl}
            placeholder={data.slack_configured ? "Replace the saved URL" : "https://hooks.slack.com/…"}
            onChange={(e) => setSlackUrl(e.target.value)}
          />
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={data.slack_enabled}
            disabled={!data.slack_configured && !slackUrl}
            onChange={(e) =>
              save.mutate({ slack_enabled: e.target.checked, ...(slackUrl ? { slack_url: slackUrl } : {}) })
            }
          />{" "}
          Post to Slack
        </label>
        <label>
          <span className="muted small">Teams webhook {data.teams_configured ? "(saved)" : "(not set)"}</span>
          <input
            type="password"
            autoComplete="off"
            value={teamsUrl}
            placeholder={data.teams_configured ? "Replace the saved URL" : "https://….webhook.office.com/…"}
            onChange={(e) => setTeamsUrl(e.target.value)}
          />
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={data.teams_enabled}
            disabled={!data.teams_configured && !teamsUrl}
            onChange={(e) =>
              save.mutate({ teams_enabled: e.target.checked, ...(teamsUrl ? { teams_url: teamsUrl } : {}) })
            }
          />{" "}
          Post to Teams
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={data.notify_status_changes}
            onChange={(e) => save.mutate({ notify_status_changes: e.target.checked })}
          />{" "}
          Status changes
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={data.notify_new_issues}
            onChange={(e) => save.mutate({ notify_new_issues: e.target.checked })}
          />{" "}
          New issues
        </label>
        <button
          className="secondary"
          disabled={(!slackUrl && !teamsUrl) || save.isPending}
          onClick={() =>
            save.mutate({
              ...(slackUrl ? { slack_url: slackUrl } : {}),
              ...(teamsUrl ? { teams_url: teamsUrl } : {}),
            })
          }
        >
          Save webhook
        </button>
      </div>
    </section>
  );
}
