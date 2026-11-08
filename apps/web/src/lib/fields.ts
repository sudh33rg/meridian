/** Custom fields: the project's typed field definitions, and how form values become API values. */
export type FieldType = "text" | "number" | "date" | "boolean" | "select";

export type FieldDefinition = {
  key: string;
  label: string;
  field_type: FieldType;
  options: string[];
  required: boolean;
  position: number;
};

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes / no",
  select: "Choice",
};

/** Builds the `custom_fields` object for a save. Empty inputs become null, which clears the value. */
export function toPayload(fields: FieldDefinition[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.key];
    if (f.field_type === "boolean") {
      out[f.key] = typeof raw === "boolean" ? raw : null;
    } else if (raw === undefined || raw === null || raw === "") {
      out[f.key] = null;
    } else if (f.field_type === "number") {
      out[f.key] = Number(raw);
    } else {
      out[f.key] = String(raw);
    }
  }
  return out;
}

/** The text an input shows for a stored value. */
export function displayValue(raw: unknown): string {
  return raw === undefined || raw === null ? "" : String(raw);
}
