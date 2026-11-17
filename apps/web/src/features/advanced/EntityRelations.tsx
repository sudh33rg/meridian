import React, { useCallback, useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { request } from "../../lib/api";
import type { Item } from "../../lib/types";
import { str } from "./shared";

export function EntityRelations({
  token,
  sourceType,
  sourceId,
  projectId,
  targetType,
}: {
  token: string;
  sourceType: "page" | "issue";
  sourceId: string;
  projectId: string;
  targetType: "page" | "issue";
}) {
  const [relations, setRelations] = useState<Item[]>([]),
    [targets, setTargets] = useState<Item[]>([]),
    [chosen, setChosen] = useState(""),
    [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!sourceId || !projectId) return;
    try {
      const [a, b] = await Promise.all([
        request<Item[]>(token, `/relations?entity_type=${sourceType}&entity_id=${sourceId}`),
        request<Item[]>(token, `/projects/${projectId}/${targetType === "page" ? "pages" : "issues"}`),
      ]);
      setRelations(a);
      setTargets(b);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sourceId, projectId, token, sourceType, targetType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const link = async () => {
    if (!chosen) return;
    try {
      await request(token, "/relations", {
        method: "POST",
        body: JSON.stringify({
          source_type: sourceType,
          source_id: sourceId,
          target_type: targetType,
          target_id: chosen,
          relation: sourceType === "page" ? "documents" : "references",
        }),
      });
      setChosen("");
      await refresh();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="relations-widget space-y-3">
      {error && (
        <div className="error p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs font-medium">
          {error}
        </div>
      )}
      <div className="relation-fields flex items-center gap-2">
        <select
          aria-label="Choose related item"
          className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-surface text-text text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
        >
          <option value="">Link {targetType}…</option>
          {targets.map((x) => (
            <option value={str(x.id)} key={str(x.id)}>
              {str(x.title)}
            </option>
          ))}
        </select>
        <button
          className="secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50"
          disabled={!chosen}
          onClick={link}
        >
          <Link2 size={14} /> Link
        </button>
      </div>
      <div className="space-y-1.5">
        {relations.map((r, n) => (
          <div
            className="relation-row flex items-center justify-between p-2 rounded-lg bg-surface-2 border border-border text-xs"
            key={str(r.id || n)}
          >
            <div className="flex items-center gap-2 text-text">
              <Link2 size={13} className="text-indigo-500 shrink-0" />
              <span className="font-medium">
                {str(r.relation)} · {str(r.source_type)} → {str(r.target_type)}
              </span>
            </div>
            <small className="text-[11px] font-mono text-muted">
              {str(r.source_id) === sourceId ? str(r.target_id).slice(0, 8) : str(r.source_id).slice(0, 8)}
            </small>
          </div>
        ))}
      </div>
      {!relations.length && (
        <p className="subtle-note text-xs text-muted">
          No linked items yet. Connect documentation directly to delivery.
        </p>
      )}
    </div>
  );
}
