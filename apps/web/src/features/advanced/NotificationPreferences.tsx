import React, { useEffect, useState } from "react";
import { request } from "../../lib/api";
import type { NotificationKind, NotificationPreference } from "../../lib/issues";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

/** Turns inbox kinds on or off for the signed-in member. The digest switch sends one email a day when the
 * server has email set up. */
const LABELS: Record<NotificationKind, { title: string; caption: string }> = {
  approval: {
    title: "Approval requests",
    caption: "When someone asks you to review an approval.",
  },
  automation: {
    title: "Automation runs",
    caption: "When an automation rule runs on an issue (workspace owners and admins).",
  },
};

export function NotificationPreferences({
  token,
  onError,
}: {
  token: string;
  onError: (message: string) => void;
}) {
  const [prefs, setPrefs] = useState<NotificationPreference[] | null>(null);
  const [digest, setDigest] = useState<{ enabled: boolean; email_available: boolean } | null>(null);

  useEffect(() => {
    request<NotificationPreference[]>(token, "/me/notification-preferences")
      .then(setPrefs)
      .catch((e: Error) => onError(e.message));
    request<{ enabled: boolean; email_available: boolean }>(token, "/me/digest")
      .then(setDigest)
      .catch((e: Error) => onError(e.message));
  }, [token, onError]);

  const changeDigest = async (enabled: boolean) => {
    if (!digest) return;
    try {
      const next = await request<{ enabled: boolean; email_available: boolean }>(token, "/me/digest", {
        method: "PUT",
        body: JSON.stringify({ enabled, email_available: digest.email_available }),
      });
      setDigest(next);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const change = async (kind: NotificationKind, enabled: boolean) => {
    try {
      const next = await request<NotificationPreference[]>(token, "/me/notification-preferences", {
        method: "PUT",
        body: JSON.stringify({ kind, enabled }),
      });
      setPrefs(next);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  if (!prefs) return null;

  return (
    <Card className="prefs">
      <CardHeader>
        <CardTitle>Notify me about</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {prefs.map((p) => (
          <label
            key={p.kind}
            className="pref-row flex items-start gap-3 p-3 rounded-xl border border-border bg-surface-2 hover:bg-surface-3 transition-colors cursor-pointer"
          >
            <input
              type="checkbox"
              className="mt-1 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              checked={p.enabled}
              onChange={(e) => change(p.kind, e.target.checked)}
            />
            <span className="flex-1">
              <b className="block text-xs sm:text-sm font-semibold text-text">{LABELS[p.kind].title}</b>
              <small className="block text-xs text-muted mt-0.5">{LABELS[p.kind].caption}</small>
            </span>
          </label>
        ))}
        {digest && (
          <label className="pref-row flex items-start gap-3 p-3 rounded-xl border border-border bg-surface-2 hover:bg-surface-3 transition-colors cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              checked={digest.enabled}
              disabled={!digest.email_available}
              onChange={(e) => void changeDigest(e.target.checked)}
            />
            <span className="flex-1">
              <b className="block text-xs sm:text-sm font-semibold text-text">Daily email digest</b>
              <small className="block text-xs text-muted mt-0.5">
                {digest.email_available
                  ? "One email a day with your unread notifications from the last day."
                  : "Email is not set up on this server, so no digest is sent."}
              </small>
            </span>
          </label>
        )}
      </CardContent>
    </Card>
  );
}
