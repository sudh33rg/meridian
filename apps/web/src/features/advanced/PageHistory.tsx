import React, { useEffect, useState } from "react";
import { History } from "lucide-react";
import { request } from "../../lib/api";
import type { Item } from "../../lib/types";
import { str, count, day } from "./shared";

export function PageHistory({
  id,
  token,
  expectedVersion,
  onRestore,
}: {
  id: string;
  token: string;
  expectedVersion: number;
  onRestore: () => void;
}) {
  const [versions, setVersions] = useState<Item[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState("");

  useEffect(() => {
    if (open)
      request<Item[]>(token, `/pages/${id}/versions`)
        .then(setVersions)
        .catch((e) => setError(e.message));
  }, [open, id, token]);

  const restore = async (version: number) => {
    if (!window.confirm(`Restore version ${version}? Current changes will be preserved as a new revision.`))
      return;
    try {
      await request(token, `/pages/${id}/restore`, {
        method: "POST",
        body: JSON.stringify({ version, expected_version: expectedVersion }),
      });
      setOpen(false);
      onRestore();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page-history relative">
      <button
        className="secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <History size={15} /> History
      </button>
      {open && (
        <div className="history-popover absolute right-0 top-full mt-2 w-72 max-w-[90vw] p-3 rounded-xl border border-border bg-surface shadow-xl z-30 space-y-2">
          {error && (
            <div className="error p-2 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs">
              {error}
            </div>
          )}
          <div className="max-h-60 overflow-y-auto divide-y divide-border pr-1">
            {versions.map((v) => (
              <div key={str(v.version)} className="ext-line flex items-center justify-between py-2">
                <div>
                  <b className="font-semibold text-text text-xs block">Version {str(v.version)}</b>
                  <small className="text-[11px] text-muted">{day(v.saved_at)}</small>
                </div>
                <button
                  className="secondary text-xs px-2.5 py-1 rounded-md border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer"
                  onClick={() => restore(count(v.version))}
                >
                  Restore
                </button>
              </div>
            ))}
            {!versions.length && (
              <p className="text-xs text-muted text-center py-4">
                Previous revisions appear after your first edit.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
