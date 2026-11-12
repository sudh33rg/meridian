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

/** Imports issues from a Meridian CSV file. The file is checked first (a dry run); the import button appears
 * only when the check finds no problems. Workspace admins only; the server refuses other members. */

export function ImportPanel({ token, projectId }: { token: string; projectId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [createStatuses, setCreateStatuses] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean) => {
    if (text === null) return;
    setBusy(true);
    try {
      const r = await api<ImportReport>(
        `/projects/${projectId}/import/csv?dry_run=${dryRun}&create_statuses=${createStatuses}`,
        token,
        {
          method: "POST",
          body: text,
          headers: { "Content-Type": "text/csv" },
        },
      );
      setReport(r);
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
        <b>Import issues</b>
        <span className="muted small">
          Needs Summary and Issue Key columns. Optional: Issue Type, Priority, Status, Description. Repeat
          imports skip issues they already created.
        </span>
      </div>
      <div className="workflow-add">
        <input
          type="file"
          accept=".csv,text/csv"
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
          <input
            type="checkbox"
            checked={createStatuses}
            onChange={(e) => setCreateStatuses(e.target.checked)}
          />{" "}
          Create statuses the file names
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
            {fileName}: {report.to_create} to create, {report.to_skip} already imported, {report.errors}{" "}
            problem
            {report.errors === 1 ? "" : "s"}
            {report.new_statuses.length > 0 && <> · new statuses: {report.new_statuses.join(", ")}</>}
            {report.committed && <> · committed</>}
          </p>
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
