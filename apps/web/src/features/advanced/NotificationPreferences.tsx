import React, { useEffect, useState } from "react";
import { request } from "../../lib/api";
import type { NotificationKind, NotificationPreference } from "../../lib/issues";

/** Turns inbox kinds on or off for the signed-in member. Email delivery is not part of this yet,
 * so the switches only control what appears in the inbox. */
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
  useEffect(() => {
    request<NotificationPreference[]>(token, "/me/notification-preferences")
      .then(setPrefs)
      .catch((e: Error) => onError(e.message));
  }, [token, onError]);

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
    <fieldset className="prefs">
      <legend>Notify me about</legend>
      {prefs.map((p) => (
        <label key={p.kind} className="pref-row">
          <input
            type="checkbox"
            checked={p.enabled}
            onChange={(e) => change(p.kind, e.target.checked)}
          />
          <span>
            <b>{LABELS[p.kind].title}</b>
            <small>{LABELS[p.kind].caption}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
