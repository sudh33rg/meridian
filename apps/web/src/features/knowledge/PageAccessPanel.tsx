import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";

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
    <Card className="my-3 bg-surface border border-border rounded-[var(--radius-lg)] p-[18px] mb-[18px] overflow-x-auto shadow-[var(--shadow-sm)] [&_h3]:m-0 [&_h3]:mb-1 [&_select]:min-w-0 [&_select]:px-3 [&_select]:py-[9px] [&_select]:border [&_select]:border-border-strong [&_select]:rounded-[10px] [&_select]:bg-surface [&_select]:text-inherit [&_input]:min-w-0 [&_input]:px-3 [&_input]:py-[9px] [&_input]:border [&_input]:border-border-strong [&_input]:rounded-[10px] [&_input]:bg-surface [&_input]:text-inherit [&_label]:grid [&_label]:gap-1.5 [&_label]:text-[13px] [&_label]:font-semibold [&_label]:text-text-muted [&_label]:mt-2.5">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <Lock size={16} className="text-accent" /> Page access
        </CardTitle>
        <button
          className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] text-text-muted hover:text-text-main"
          onClick={onClose}
        >
          Close
        </button>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <div className="p-2.5 rounded-lg bg-danger-soft border border-danger-border text-danger-text text-xs font-medium py-[11px] px-[13px] my-3">
            {error}
          </div>
        )}
        {!d ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : (
          <>
            <p className="text-xs sm:text-sm text-muted">
              {d.restricted
                ? "Only the people and teams below can open this page (and its sub-pages)."
                : inherited
                  ? "This page inherits the restriction of a parent page."
                  : "Everyone who can open the project can open this page."}
            </p>
            {canManage && !inherited && (
              <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-text cursor-pointer flex-wrap">
                <input
                  type="checkbox"
                  className="rounded accent-accent text-accent focus:ring-accent cursor-pointer"
                  checked={d.restricted}
                  disabled={restrict.isPending}
                  onChange={(e) => restrict.mutate(e.target.checked)}
                />
                <span>Restrict this page</span>
              </label>
            )}
            {d.restricted && canManage && (
              <div className="space-y-3 pt-2">
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs text-left border-collapse [&_th]:text-left [&_th]:px-2 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-border [&_td]:text-left [&_td]:px-2 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-border">
                    <tbody className="divide-y divide-border">
                      {d.grants.map((g) => (
                        <tr
                          key={g.subject_type + g.subject_id}
                          className="hover:bg-surface-2 transition-colors"
                        >
                          <td className="py-2 px-3 font-medium text-text">
                            {g.name || g.subject_id}{" "}
                            <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold bg-surface-2 border border-border text-muted inline-block">
                              {g.subject_type}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-muted capitalize">{g.relation}</td>
                          <td className="py-2 px-3 text-right">
                            <button
                              className="text-xs px-2 py-1 rounded border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer text-danger-text inline-flex items-center justify-center gap-2 whitespace-nowrap font-[650] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] hover:text-text-main"
                              onClick={() => revoke.mutate(g)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                      {d.grants.length === 0 && (
                        <tr>
                          <td colSpan={3} className="py-4 text-center text-xs text-muted">
                            No explicit grants yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Person or team"
                    className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-lg border border-border bg-surface text-text text-xs focus:outline-hidden focus:ring-2 focus:ring-accent/20"
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
                  <select
                    aria-label="Access level"
                    className="px-2.5 py-1.5 rounded-lg border border-border bg-surface text-text text-xs focus:outline-hidden focus:ring-2 focus:ring-accent/20"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                  >
                    <option value="viewer">Can view</option>
                    <option value="editor">Can edit</option>
                  </select>
                  <button
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-strong transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap duration-[120ms] active:translate-y-px disabled:cursor-not-allowed min-h-[var(--control-h)] shadow-[var(--shadow-sm)]"
                    disabled={!subject || grant.isPending}
                    onClick={() => grant.mutate()}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
