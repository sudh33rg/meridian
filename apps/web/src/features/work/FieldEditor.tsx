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
        options: type === "select" ? options.split(",").map((o) => o.trim()).filter(Boolean) : undefined,
        required,
      }),
    onSuccess: (f) => {
      setLabel("");
      setOptions("");
      setRequired(false);
      toast(`Added field “${f.label}”`);
      void refresh();
    },
    onError: fail,
  });
  const toggleRequired = useMutation({
    mutationFn: (f: FieldDefinition) =>
      send<FieldDefinition>(`/projects/${projectId}/fields/${f.key}`, token, "PATCH", { required: !f.required }),
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
    <section className="workflow" aria-label="Custom fields">
      <div className="workflow-head">
        <b>Custom fields</b>
        <span className="muted small">Shown on every issue in this project. Required fields must be filled to save.</span>
      </div>
      <ul className="workflow-list">
        {fields.map((f) => (
          <li key={f.key} className="workflow-row">
            <span>
              {f.label}
              <span className="muted small"> · {FIELD_TYPE_LABEL[f.field_type]}
                {f.field_type === "select" ? ` (${f.options.join(", ")})` : ""}</span>
            </span>
            <button
              className="secondary"
              aria-pressed={f.required}
              disabled={toggleRequired.isPending}
              onClick={() => toggleRequired.mutate(f)}
            >
              {f.required ? "Required" : "Optional"}
            </button>
            <button
              className="icon-btn danger"
              aria-label={`Delete field ${f.label}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(f.key)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!fields.length && !fieldsQ.isLoading && <li className="muted small">No custom fields yet.</li>}
      </ul>
      <form
        className="workflow-add"
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
        <select aria-label="New field type" value={type} onChange={(e) => setType(e.target.value as FieldType)}>
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
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
        <button className="secondary" type="submit" disabled={!label.trim() || add.isPending}>
          <Plus size={14} /> Add field
        </button>
      </form>
    </section>
  );
}
