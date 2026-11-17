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
    <div className="space-y-3 py-3">
      {error && (
        <div className="p-2.5 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs font-medium py-[11px] px-[13px] my-3">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 mt-[7px] mb-3 [&_select]:bg-surface [&_select]:min-w-0 [&_select]:flex-1 [&_select]:border [&_select]:border-border-strong [&_select]:rounded-lg [&_select]:p-[9px] [&_select]:text-text-muted [&_select]:text-xs">
        <select
          aria-label="Choose related item"
          className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-surface text-text text-xs focus:outline-hidden focus:ring-2 focus:ring-accent/20"
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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50 justify-center whitespace-nowrap duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
          disabled={!chosen}
          onClick={link}
        >
          <Link2 size={14} /> Link
        </button>
      </div>
      <div className="space-y-1.5">
        {relations.map((r, n) => (
          <div
            className="flex items-center justify-between p-2 rounded-lg bg-surface-2 border border-border text-xs gap-2 px-0.5 py-[9px] border-t text-text-muted [&_span]:flex-1 [&_small]:text-text-subtle"
            key={str(r.id || n)}
          >
            <div className="flex items-center gap-2 text-text">
              <Link2 size={13} className="text-accent shrink-0" />
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
        <p className="text-xs text-muted">No linked items yet. Connect documentation directly to delivery.</p>
      )}
    </div>
  );
}
