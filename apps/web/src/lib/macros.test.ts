import { describe, expect, it } from "vitest";
import { splitMacros } from "./macros";

describe("splitMacros", () => {
  it("splits plain text without macros", () => {
    const text = "This is a regular document without any macros.";
    const segments = splitMacros(text);
    expect(segments).toEqual([{ kind: "text", text }]);
  });

  it("identifies known macros with arguments", () => {
    const text = 'Before macro {{issues query="status:done" limit=5}} after macro.';
    const segments = splitMacros(text);
    expect(segments.length).toBe(3);
    expect(segments[0]).toEqual({ kind: "text", text: "Before macro " });
    expect(segments[1]).toEqual({
      kind: "macro",
      macro: {
        name: "issues",
        args: { query: "status:done", limit: "5" },
      },
      raw: '{{issues query="status:done" limit=5}}',
    });
    expect(segments[2]).toEqual({ kind: "text", text: " after macro." });
  });

  it("marks unknown or malformed macros as invalid", () => {
    const text = "Start {{unknown_macro arg=1}} end.";
    const segments = splitMacros(text);
    expect(segments).toEqual([
      { kind: "text", text: "Start " },
      { kind: "invalid", raw: "{{unknown_macro arg=1}}" },
      { kind: "text", text: " end." },
    ]);
  });
});
