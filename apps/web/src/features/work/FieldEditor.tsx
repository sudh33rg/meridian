import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { errorMessage, request, send } from "../../lib/api";
import { FIELD_TYPE_LABEL, type FieldDefinition, type FieldType } from "../../lib/fields";
import { useToast } from "../shared/Toast";

const TYPES = Object.keys(FIELD_TYPE_LABEL) as FieldType[];

/** The project's custom fields: add, make required or optional, and delete. Only project admins can
 * change them; the server refuses other members. Keys and types are fixed once a field exists. */
export function FieldEditor({ token, projectId }: { token: string; projectId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const fieldsQ = useQuery({
    queryKey: ["fields", projectId],
    queryFn: () => request<FieldDefinition[]>(token, `/projects/${projectId}/fields`),
    enabled: !!projectId,
  });
  const fields = fieldsQ.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["fields", projectId] });
  const fail = (e: unknown) => toast(errorMessage(e), { kind: "error" });

  const add = useMutation({
    mutationFn: () =>
      send<FieldDefinition>(`/projects/${projectId}/fields`, token, "POST", {
        label: label.trim(),
        field_type: type,
        options:
          type === "select"
            ? options
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean)
            : undefined,
        required,
        restricted,
      }),
    onSuccess: (f) => {
      setLabel("");
      setOptions("");
      setRequired(false);
      setRestricted(false);
      toast(`Added field “${f.label}”`);
      void refresh();
    },
    onError: fail,
  });
  const toggleRestricted = useMutation({
    mutationFn: (f: FieldDefinition) =>
      send<FieldDefinition>(`/projects/${projectId}/fields/${f.key}`, token, "PATCH", {
        restricted: !f.restricted,
      }),
    onSuccess: () => void refresh(),
    onError: fail,
  });
  const toggleRequired = useMutation({
    mutationFn: (f: FieldDefinition) =>
      send<FieldDefinition>(`/projects/${projectId}/fields/${f.key}`, token, "PATCH", {
        required: !f.required,
      }),
    onSuccess: () => void refresh(),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (key: string) => send<void>(`/projects/${projectId}/fields/${key}`, token, "DELETE"),
    onSuccess: () => {
      toast("Field deleted; its values were removed from issues");
      void refresh();
    },
    onError: fail,
  });

  return (
    <section
      className="mb-4 px-3.5 py-3 border border-border rounded-xl bg-surface-2 grid gap-2.5"
      aria-label="Custom fields"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b>Custom fields</b>
        <span className="text-text-subtle text-[11px]">
          Shown on every issue in this project. Required fields must be filled to save.
        </span>
      </div>
      <ul className="m-0 p-0 list-none grid gap-1.5">
        {fields.map((f) => (
          <li
            key={f.key}
            className="grid grid-cols-[minmax(140px,1fr)_140px_auto_auto_auto] gap-1.5 items-center max-[640px]:flex max-[640px]:flex-wrap max-[640px]:gap-2 [&_input]:min-w-0 [&_input]:max-[640px]:flex-[1_1_120px] [&_select]:min-w-0 [&_select]:max-[640px]:flex-[1_1_120px]"
          >
            <span>
              {f.label}
              <span className="text-text-subtle text-[11px]">
                {" "}
                · {FIELD_TYPE_LABEL[f.field_type]}
                {f.field_type === "select" ? ` (${f.options.join(", ")})` : ""}
              </span>
            </span>
            <button
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] rounded-[var(--radius)] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 text-[13px] bg-surface border border-border-strong text-text-muted hover:bg-surface-3 hover:text-text-main"
              aria-pressed={f.required}
              disabled={toggleRequired.isPending}
              onClick={() => toggleRequired.mutate(f)}
            >
              {f.required ? "Required" : "Optional"}
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] rounded-[var(--radius)] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 text-[13px] bg-surface border border-border-strong text-text-muted hover:bg-surface-3 hover:text-text-main"
              aria-pressed={!!f.restricted}
              title="Restricted fields are seen and changed by project admins only"
              disabled={toggleRestricted.isPending}
              onClick={() => toggleRestricted.mutate(f)}
            >
              {f.restricted ? "Admins only" : "Visible to members"}
            </button>
            <button
              className="inline-grid place-items-center rounded-lg p-[5px] text-text-subtle transition-colors hover:bg-surface-3 hover:text-text-main text-danger-text"
              aria-label={`Delete field ${f.label}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(f.key)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!fields.length && !fieldsQ.isLoading && (
          <li className="text-text-subtle text-[11px]">No custom fields yet.</li>
        )}
      </ul>
      <form
        className="flex flex-wrap gap-2 items-center [&_input]:min-w-[180px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim()) add.mutate();
        }}
      >
        <input
          aria-label="New field label"
          placeholder="Field name"
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
        />
        <select
          aria-label="New field type"
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        {type === "select" && (
          <input
            aria-label="Choices, separated by commas"
            placeholder="Choices, comma separated"
            value={options}
            onChange={(e) => setOptions(e.target.value)}
          />
        )}
        <label className="inline-check">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />{" "}
          Required
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} />{" "}
          Admins only
        </label>
        <button
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer font-[650] rounded-[var(--radius)] transition-[background-color,border-color,transform] duration-[120ms] active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed min-h-[var(--control-h)] px-3.5 text-[13px] bg-surface border border-border-strong text-text-muted hover:bg-surface-3 hover:text-text-main"
          type="submit"
          disabled={!label.trim() || add.isPending}
        >
          <Plus size={14} /> Add field
        </button>
      </form>
    </section>
  );
}
