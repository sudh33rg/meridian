import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Trash2 } from "lucide-react";
import { api, errorMessage, send } from "../../lib/api";

type Row = {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  scan_status: "pending" | "clean" | "infected" | "skipped" | "error";
  uploaded_by: string;
  created_at: string;
};

const size = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const badge: Record<Row["scan_status"], string> = {
  pending: "Scanning…",
  clean: "Scanned",
  infected: "Blocked",
  skipped: "Not scanned",
  error: "Scan failed",
};

export function Attachments({
  entityType,
  entityId,
  canEdit,
}: {
  entityType: "issue" | "page";
  entityId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const key = ["attachments", entityId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<Row[]>(`/attachments?entity_type=${entityType}&entity_id=${entityId}`),
    refetchInterval: (q) => (q.state.data?.some((r) => r.scan_status === "pending") ? 2000 : false),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("entity_type", entityType);
      form.append("entity_id", entityId);
      form.append("file", file);
      return api<unknown>("/attachments", undefined, { method: "POST", body: form });
    },
    onSuccess: () => {
      setError("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => send<void>(`/attachments/${id}`, "", "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => setError(errorMessage(e)),
  });
  const rows = list.data ?? [];
  return (
    <div className="attachments">
      <div className="row-gap" style={{ justifyContent: "space-between" }}>
        <h4 style={{ margin: 0 }}>
          <Paperclip size={14} /> Attachments · {rows.length}
        </h4>
        {canEdit && (
          <>
            <input
              ref={input}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = "";
              }}
            />
            <button className="secondary" disabled={upload.isPending} onClick={() => input.current?.click()}>
              {upload.isPending ? "Uploading…" : "Attach a file"}
            </button>
          </>
        )}
      </div>
      {error && (
        <div className="error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      <ul className="attach-list">
        {rows.map((r) => (
          <li key={r.id}>
            {r.content_type.startsWith("image/") && r.scan_status !== "infected" && (
              <img
                src={`/api/attachments/${r.id}/download?inline=true`}
                alt=""
                width={36}
                height={36}
                style={{ objectFit: "cover", borderRadius: 6 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              {r.scan_status === "infected" ? (
                <span>{r.file_name}</span>
              ) : (
                <a href={`/api/attachments/${r.id}/download`}>{r.file_name}</a>
              )}
              <div className="muted small">
                {size(r.size_bytes)} · {r.uploaded_by} ·{" "}
                <span className={"scan " + r.scan_status}>{badge[r.scan_status]}</span>
              </div>
            </div>
            {canEdit && (
              <button
                className="icon-btn"
                title="Delete"
                aria-label={`Delete ${r.file_name}`}
                onClick={() => remove.mutate(r.id)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </li>
        ))}
        {!rows.length && <li className="muted small">No files yet.</li>}
      </ul>
    </div>
  );
}
