import { describe, expect, it } from "vitest";
import { type FieldDefinition, displayValue, toPayload } from "./fields";

describe("custom field helpers", () => {
  const definitions: FieldDefinition[] = [
    {
      key: "story_pts",
      label: "Story Points",
      field_type: "number",
      options: [],
      required: false,
      position: 0,
    },
    { key: "reviewed", label: "Reviewed", field_type: "boolean", options: [], required: false, position: 1 },
    { key: "component", label: "Component", field_type: "text", options: [], required: true, position: 2 },
    { key: "tier", label: "Tier", field_type: "select", options: ["P0", "P1"], required: false, position: 3 },
  ];

  it("converts form values to typed payload", () => {
    const raw = {
      story_pts: "13",
      reviewed: true,
      component: "Billing",
      tier: "P0",
    };
    const payload = toPayload(definitions, raw);
    expect(payload).toEqual({
      story_pts: 13,
      reviewed: true,
      component: "Billing",
      tier: "P0",
    });
  });

  it("clears empty string inputs to null", () => {
    const raw = {
      story_pts: "",
      reviewed: false,
      component: "",
      tier: "",
    };
    const payload = toPayload(definitions, raw);
    expect(payload).toEqual({
      story_pts: null,
      reviewed: false,
      component: null,
      tier: null,
    });
  });

  it("formats display value gracefully", () => {
    expect(displayValue(null)).toBe("");
    expect(displayValue(undefined)).toBe("");
    expect(displayValue(42)).toBe("42");
    expect(displayValue("Active")).toBe("Active");
  });
});
