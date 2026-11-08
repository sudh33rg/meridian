import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api";
import { useToast } from "../shared/Toast";

export type ImportRow = { line: number; action: "create" | "skip" | "error"; message: string | null };
export type ImportReport = {
  dry_run: boolean;
  committed: boolean;
  to_create: number;
  to_skip: number;
  errors: number;
  new_statuses: string[];
  rows: ImportRow[];
};

type JiraExtras = {
  dry_run: boolean;
  issues_not_found: number;
  sprints_to_create: number;
  issues_in_sprints: number;
  releases_to_create: number;
  issues_in_releases: number;
  status_changes_to_add: number;
  status_changes_skipped: number;
};

/** Imports issues from a CSV export, or from a Jira issues JSON file (with sprints, versions and history). The file is checked first (a dry run); the import button appears
 * only when the check finds no problems. Workspace admins only; the server refuses other members. */
export function ImportPanel({ token, projectId }: { token: string; projectId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [createStatuses, setCreateStatuses] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [extras, setExtras] = useState<JiraExtras | null>(null);
  const [busy, setBusy] = useState(false);
  const isJson = fileName.toLowerCase().endsWith(".json");

  const run = async (dryRun: boolean) => {
    if (text === null) return;
    setBusy(true);
    try {
      const r = isJson
        ? await api<ImportReport>(`/projects/${projectId}/import/jira?dry_run=${dryRun}&create_statuses=${createStatuses}`, token, {
            method: "POST",
            body: text,
            headers: { "Content-Type": "application/json" },
          })
        : await api<ImportReport>(`/projects/${projectId}/import/csv?dry_run=${dryRun}&create_statuses=${createStatuses}`, token, {
            method: "POST",
            body: text,
            headers: { "Content-Type": "text/csv" },
          });
      setReport(r);
      if (isJson) {
        // Sprints, versions and status history come after the issues exist. The same dry run applies.
        const x = await api<JiraExtras>(`/projects/${projectId}/import/jira/extras?dry_run=${dryRun}`, token, {
          method: "POST",
          body: text,
          headers: { "Content-Type": "application/json" },
        });
        setExtras(x);
      }
      if (r.committed) {
        toast(`Imported ${r.to_create} issue${r.to_create === 1 ? "" : "s"}`);
        void qc.invalidateQueries({ queryKey: ["issues", projectId] });
        void qc.invalidateQueries({ queryKey: ["statuses", projectId] });
        void qc.invalidateQueries({ queryKey: ["sprints", projectId] });
        void qc.invalidateQueries({ queryKey: ["releases", projectId] });
      }
    } catch (e) {
      toast(errorMessage(e), { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workflow" aria-label="Import issues from CSV">
      <div className="workflow-head">
        <b>Import from CSV</b>
        <span className="muted small">
          Needs Summary and Issue Key columns. Optional: Issue Type, Priority, Status, Description. Repeat imports skip
          issues they already created.
        </span>
      </div>
      <div className="workflow-add">
        <input
          type="file"
          accept=".csv,.json,text/csv,application/json"
          aria-label="CSV file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setReport(null);
            if (!file) {
              setText(null);
              return;
            }
            setFileName(file.name);
            void file.text().then(setText);
          }}
        />
        <label className="inline-check">
          <input type="checkbox" checked={createStatuses} onChange={(e) => setCreateStatuses(e.target.checked)} /> Create
          statuses the file names
        </label>
        <button className="secondary" disabled={text === null || busy} onClick={() => run(true)}>
          Check file
        </button>
        {report && report.errors === 0 && report.to_create > 0 && !report.committed && (
          <button className="primary" disabled={busy} onClick={() => run(false)}>
            Import {report.to_create} issue{report.to_create === 1 ? "" : "s"}
          </button>
        )}
      </div>
      {report && (
        <div className="import-report" role="status">
          <p>
            {fileName}: {report.to_create} to create, {report.to_skip} already imported, {report.errors} problem
            {report.errors === 1 ? "" : "s"}
            {report.new_statuses.length > 0 && <> · new statuses: {report.new_statuses.join(", ")}</>}
            {report.committed && <> · committed</>}
          </p>
          {extras && (
            <p>
              Jira extras: {extras.sprints_to_create} sprint{extras.sprints_to_create === 1 ? "" : "s"} to create (
              {extras.issues_in_sprints} issues), {extras.releases_to_create} release
              {extras.releases_to_create === 1 ? "" : "s"} to create ({extras.issues_in_releases} links),{" "}
              {extras.status_changes_to_add} status change{extras.status_changes_to_add === 1 ? "" : "s"} to add
              {extras.status_changes_skipped > 0 && <>, {extras.status_changes_skipped} skipped (unknown status)</>}
              {extras.issues_not_found > 0 && <>, {extras.issues_not_found} not imported yet</>}.
            </p>
          )}
          {report.errors > 0 && (
            <ul>
              {report.rows
                .filter((r) => r.action === "error")
                .slice(0, 20)
                .map((r, n) => (
                  <li key={n}>
                    {r.line > 0 ? `Line ${r.line}: ` : ""}
                    {r.message}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
