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
    <div className="relative inline-flex">
      <button
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer justify-center whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
        onClick={() => setOpen(!open)}
      >
        <History size={15} /> History
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 max-w-[90vw] p-3 rounded-xl border border-border bg-surface shadow-xl z-30 space-y-2 max-h-[350px] overflow-auto [&_p]:p-[15px] [&_p]:text-xs [&_p]:text-text-subtle">
          {error && (
            <div className="p-2 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs py-[11px] px-[13px] my-3">
              {error}
            </div>
          )}
          <div className="max-h-60 overflow-y-auto divide-y divide-border pr-1">
            {versions.map((v) => (
              <div
                key={str(v.version)}
                className="flex items-center justify-between py-2 px-[22px] gap-3.5 border-b border-border last:border-b-0 text-text-muted text-xs max-[760px]:p-3.5 [&>div:not(:first-child)]:flex-1 [&>div:not(:first-child)]:min-w-0 [&_b]:text-xs [&_b]:text-text-main [&_b]:block [&_small]:text-[10px] [&_small]:block [&_small]:text-text-subtle [&_small]:mt-[5px] [&_small]:whitespace-nowrap [&_small]:text-ellipsis [&_small]:overflow-hidden"
              >
                <div>
                  <b className="font-semibold text-text text-xs block">Version {str(v.version)}</b>
                  <small className="text-[11px] text-muted">{day(v.saved_at)}</small>
                </div>
                <button
                  className="text-xs px-2.5 py-1 rounded-md border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap font-[650] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
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
