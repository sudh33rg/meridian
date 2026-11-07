import React, { useEffect, useState } from "react";
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
  const refresh = async () => {
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
  };
  useEffect(() => {
    void refresh();
  }, [sourceId, projectId, token]);
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
    <div className="relations-widget">
      {error && <div className="error">{error}</div>}
      <div className="relation-fields">
        <select aria-label="Choose related item" value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">Link {targetType}…</option>
          {targets.map((x) => (
            <option value={str(x.id)} key={str(x.id)}>
              {str(x.title)}
            </option>
          ))}
        </select>
        <button className="secondary" disabled={!chosen} onClick={link}>
          <Link2 size={14} /> Link
        </button>
      </div>
      {relations.map((r, n) => (
        <div className="relation-row" key={str(r.id || n)}>
          <Link2 size={13} />
          <span>
            {str(r.relation)} · {str(r.source_type)} → {str(r.target_type)}
          </span>
          <small>
            {str(r.source_id) === sourceId ? str(r.target_id).slice(0, 8) : str(r.source_id).slice(0, 8)}
          </small>
        </div>
      ))}
      {!relations.length && (
        <p className="subtle-note">No linked items yet. Connect documentation directly to delivery.</p>
      )}
    </div>
  );
}
