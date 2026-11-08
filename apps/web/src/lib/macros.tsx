import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { Markdown } from "./markdown";

/**
 * Macros in page text (see the server's macros module): `{{issues query="..." limit=N}}`,
 * `{{table query="..." limit=N}}` and `{{chart by=status query="..."}}`. Each one is a search over the
 * project's issues, so the server applies the same visibility rules as everywhere else. A macro this
 * renderer does not recognise is shown as plain text, never run.
 */
type Macro = { name: string; args: Record<string, string> };
type Segment = { kind: "text"; text: string } | { kind: "macro"; macro: Macro; raw: string } | { kind: "invalid"; raw: string };

function parseMacro(body: string): Macro | null {
  const trimmed = body.trim();
  const nameEnd = trimmed.search(/\s/);
  const name = nameEnd < 0 ? trimmed : trimmed.slice(0, nameEnd);
  if (!name) return null;
  const args: Record<string, string> = {};
  let rest = nameEnd < 0 ? "" : trimmed.slice(nameEnd).trimStart();
  while (rest) {
    const eq = rest.indexOf("=");
    if (eq < 0) return null;
    const key = rest.slice(0, eq).trim();
    if (!/^[a-z_]+$/.test(key)) return null;
    let after = rest.slice(eq + 1).trimStart();
    let value: string;
    if (after.startsWith('"')) {
      const close = after.indexOf('"', 1);
      if (close < 0) return null;
      value = after.slice(1, close);
      after = after.slice(close + 1);
    } else {
      const end = after.search(/\s/);
      value = end < 0 ? after : after.slice(0, end);
      after = end < 0 ? "" : after.slice(end);
    }
    args[key] = value;
    rest = after.trimStart();
  }
  return { name, args };
}

export function splitMacros(content: string): Segment[] {
  const out: Segment[] = [];
  let rest = content;
  for (;;) {
    const start = rest.indexOf("{{");
    if (start < 0) break;
    const end = rest.indexOf("}}", start + 2);
    if (end < 0) break;
    if (start > 0) out.push({ kind: "text", text: rest.slice(0, start) });
    const raw = rest.slice(start, end + 2);
    const macro = parseMacro(rest.slice(start + 2, end));
    const known = macro && ["issues", "table", "chart"].includes(macro.name);
    out.push(known ? { kind: "macro", macro, raw } : { kind: "invalid", raw });
    rest = rest.slice(end + 2);
  }
  if (rest) out.push({ kind: "text", text: rest });
  return out;
}

type Issue = { id: string; number: number; title: string; status: string; priority: string };

function MacroBlock({ token, projectId, macro }: { token: string; projectId: string; macro: Macro }) {
  const isChart = macro.name === "chart";
  const limit = Math.min(50, Math.max(1, Number(macro.args.limit ?? "20") || 20));
  const query = macro.args.query ?? "";
  const issuesQ = useQuery({
    queryKey: ["macro", projectId, macro.name, query, limit],
    // Search needs a query; without one the macro reads the project's issues in list order.
    queryFn: () =>
      query.trim()
        ? api<Issue[]>(
            `/projects/${projectId}/issues/search?${new URLSearchParams({
              query,
              limit: String(isChart ? 200 : limit),
            }).toString()}`,
            token,
          )
        : api<Issue[]>(`/projects/${projectId}/issues?limit=${isChart ? 200 : limit}`, token),
  });
  if (issuesQ.isLoading) return <p className="muted small">Loading…</p>;
  if (issuesQ.isError) return <p className="error">This macro could not be loaded.</p>;
  const issues = issuesQ.data ?? [];
  if (isChart) {
    const by = (macro.args.by ?? "status") as "status" | "priority" | "kind";
    const counts = new Map<string, number>();
    for (const i of issues) {
      const key = String((i as unknown as Record<string, unknown>)[by] ?? "");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    return (
      <div className="macro-chart" role="img" aria-label={`Issues by ${by}`}>
        {[...counts.entries()].map(([key, n]) => (
          <div key={key} className="macro-bar-row">
            <span>{key}</span>
            <span className="macro-bar" style={{ width: `${Math.round((n / max) * 100)}%` }} />
            <span className="muted small">{n}</span>
          </div>
        ))}
        {!counts.size && <p className="muted small">No matching issues.</p>}
      </div>
    );
  }
  if (macro.name === "table") {
    return (
      <table className="macro-table">
        <caption className="muted small">Issues matching “{query || "all"}”</caption>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.id}>
              <td>{i.number}</td>
              <td>{i.title}</td>
              <td>{i.status}</td>
              <td>{i.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <ul className="macro-list">
      {issues.map((i) => (
        <li key={i.id}>
          #{i.number} {i.title} <span className="muted small">· {i.status}</span>
        </li>
      ))}
      {!issues.length && <li className="muted small">No matching issues.</li>}
    </ul>
  );
}

/** A page's text with its macros rendered. Text is shown as markdown; macros run as searches. */
export function PageBody({ content, token, projectId }: { content: string; token: string; projectId: string }) {
  const segments = splitMacros(content);
  return (
    <div className="page-body">
      {segments.map((s, n) => {
        if (s.kind === "text") return <Markdown key={n} source={s.text} />;
        if (s.kind === "macro") return <MacroBlock key={n} token={token} projectId={projectId} macro={s.macro} />;
        return (
          <p key={n} className="muted small" role="note">
            Unknown macro shown as text: <code>{s.raw}</code>
          </p>
        );
      })}
    </div>
  );
}
