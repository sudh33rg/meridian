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
    <div className="page-history">
      <button className="secondary" onClick={() => setOpen(!open)}>
        <History size={15} /> History
      </button>
      {open && (
        <div className="history-popover">
          {error && <div className="error">{error}</div>}
          {versions.map((v) => (
            <div key={str(v.version)} className="ext-line">
              <div>
                <b>Version {str(v.version)}</b>
                <small>{day(v.saved_at)}</small>
              </div>
              <button className="secondary" onClick={() => restore(count(v.version))}>
                Restore
              </button>
            </div>
          ))}
          {!versions.length && <p>Previous revisions appear after your first edit.</p>}
        </div>
      )}
    </div>
  );
}
