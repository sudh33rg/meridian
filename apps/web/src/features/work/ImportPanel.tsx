import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api";
import { useToast } from "../shared/Toast";
import { Card, CardHeader, CardTitle, CardContent } from "../shared/UiComponents";
import { Upload, CheckCircle2, AlertCircle } from "lucide-react";

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
    <Card className="workflow" aria-label="Import issues from CSV">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload size={18} className="text-indigo-500" />
          Import issues from CSV
        </CardTitle>
        <p className="muted small text-xs sm:text-sm text-muted mt-1">
          Needs Summary and Issue Key columns. Optional: Issue Type, Priority, Status, Description. Repeat
          imports skip issues they already created.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="workflow-add flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="block text-xs text-text file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-border file:text-xs file:font-semibold file:bg-surface-2 file:text-text hover:file:bg-surface-3 cursor-pointer"
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
          <label className="inline-check flex items-center gap-2 text-xs font-medium text-text cursor-pointer">
            <input
              type="checkbox"
              className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              checked={createStatuses}
              onChange={(e) => setCreateStatuses(e.target.checked)}
            />
            <span>Create statuses the file names</span>
          </label>
          <button
            className="secondary px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-surface hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50"
            disabled={text === null || busy}
            onClick={() => run(true)}
          >
            Check file
          </button>
          {report && report.errors === 0 && report.to_create > 0 && !report.committed && (
            <button
              className="primary px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50"
              disabled={busy}
              onClick={() => run(false)}
            >
              Import {report.to_create} issue{report.to_create === 1 ? "" : "s"}
            </button>
          )}
        </div>

        {report && (
          <div
            className={`import-report p-3 rounded-xl border text-xs sm:text-sm space-y-2 ${
              report.errors > 0
                ? "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200"
                : "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200"
            }`}
            role="status"
          >
            <p className="font-semibold flex items-center gap-1.5">
              {report.errors > 0 ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
              {fileName}: {report.to_create} to create, {report.to_skip} already imported, {report.errors}{" "}
              problem{report.errors === 1 ? "" : "s"}
              {report.new_statuses.length > 0 && <> · new statuses: {report.new_statuses.join(", ")}</>}
              {report.committed && <> · committed</>}
            </p>
            {report.errors > 0 && (
              <ul className="list-disc list-inside space-y-1 text-xs opacity-90 pl-1">
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
      </CardContent>
    </Card>
  );
}
