import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatWith, setWorkspaceTimeZone } from "./datetime";

describe("datetime utilities", () => {
  it("formats calendar dates without shifting days", () => {
    // 2026-11-12 calendar date
    const formatted = formatDate("2026-11-12");
    expect(formatted).toMatch(/12/);
    expect(formatted).toMatch(/2026/);
  });

  it("returns fallback for null or empty dates", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("invalid-date-string")).toBe("—");
  });

  it("formats timestamps with time", () => {
    const timestamp = "2026-11-12T15:30:00.000Z";
    const formatted = formatDateTime(timestamp);
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/12/);
  });

  it("handles custom timezone setting", () => {
    setWorkspaceTimeZone("America/New_York");
    const timestamp = "2026-11-12T20:00:00.000Z";
    const formatted = formatWith(timestamp, { hour: "numeric", timeZone: "America/New_York" });
    expect(formatted).toBeTruthy();
    // Reset timezone
    setWorkspaceTimeZone(null);
  });
});
