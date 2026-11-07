import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";

type Info = {
  restricted: boolean;
  governed_by: string | null;
  your_level: number;
  grants: {
    subject_type: "user" | "team";
    subject_id: string;
    name?: string;
    email?: string;
    relation: string;
  }[];
};
type Member = { id: string; name: string; email: string };
type Team = { id: string; name: string };

/** Restrict a page to chosen people/teams (children inherit the restriction). */
export function PageAccessPanel({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("viewer");
  const [error, setError] = useState("");
  const key = ["page-access", pageId];
  const info = useQuery({ queryKey: key, queryFn: () => api<Info>(`/pages/${pageId}/access`) });
  const canManage = (info.data?.your_level ?? 0) >= 2;
  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => api<Member[]>("/members"),
    enabled: canManage,
  });
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api<Team[]>("/teams"), enabled: canManage });
  const done = () => qc.invalidateQueries({ queryKey: key });
  const fail = (e: unknown) => setError(errorMessage(e));
  const restrict = useMutation({
    mutationFn: (v: boolean) => send<void>(`/pages/${pageId}/restriction`, "", "PUT", { restricted: v }),
    onSuccess: done,
    onError: fail,
  });
  const grant = useMutation({
    mutationFn: () => {
      const [subject_type, subject_id] = subject.split(":");
      return send<void>(`/pages/${pageId}/grants`, "", "PUT", { subject_type, subject_id, level });
    },
    onSuccess: () => {
      setSubject("");
      done();
    },
    onError: fail,
  });
  const revoke = useMutation({
    mutationFn: (g: { subject_type: string; subject_id: string }) =>
      send<void>(`/pages/${pageId}/grants/${g.subject_type}/${g.subject_id}`, "", "DELETE"),
    onSuccess: done,
    onError: fail,
  });
  const d = info.data;
  const inherited = d && !d.restricted && d.governed_by;
  return (
    <div className="panel-card" style={{ margin: "10px 0" }}>
      <div className="row-gap" style={{ justifyContent: "space-between" }}>
        <h3>
          <Lock size={16} /> Page access
        </h3>
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {!d ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <p className="muted">
            {d.restricted
              ? "Only the people and teams below can open this page (and its sub-pages)."
              : inherited
                ? "This page inherits the restriction of a parent page."
                : "Everyone who can open the project can open this page."}
          </p>
          {canManage && !inherited && (
            <label className="row-gap" style={{ fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={d.restricted}
                disabled={restrict.isPending}
                onChange={(e) => restrict.mutate(e.target.checked)}
              />
              Restrict this page
            </label>
          )}
          {d.restricted && canManage && (
            <>
              <table className="panel-table">
                <tbody>
                  {d.grants.map((g) => (
                    <tr key={g.subject_type + g.subject_id}>
                      <td>
                        {g.name || g.subject_id} <span className="tag">{g.subject_type}</span>
                      </td>
                      <td>{g.relation}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="secondary" onClick={() => revoke.mutate(g)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row-gap" style={{ marginTop: 10 }}>
                <select
                  aria-label="Person or team"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  <option value="">Add a person or team…</option>
                  <optgroup label="People">
                    {(members.data ?? []).map((m) => (
                      <option key={m.id} value={`user:${m.id}`}>
                        {m.name} ({m.email})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Teams">
                    {(teams.data ?? []).map((t) => (
                      <option key={t.id} value={`team:${t.id}`}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <select aria-label="Access level" value={level} onChange={(e) => setLevel(e.target.value)}>
                  <option value="viewer">Can view</option>
                  <option value="editor">Can edit</option>
                </select>
                <button
                  className="primary"
                  disabled={!subject || grant.isPending}
                  onClick={() => grant.mutate()}
                >
                  Add
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
