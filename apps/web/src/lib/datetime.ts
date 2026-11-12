/**
 * Dates shown to people. Timestamps render in the workspace time zone (Workspace settings). Calendar
 * dates (YYYY-MM-DD, such as due dates) render as the same day everywhere, so they never shift.
 * An unknown or unsupported zone falls back to this browser's zone, because the server checks the
 * zone's format but not the list of zones.
 */
import { currentLocale } from "./i18n";

let zone: string | undefined;

export function setWorkspaceTimeZone(tz: string | undefined | null) {
  zone = tz || undefined;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Formats a date with explicit options. Use the named helpers below unless a layout needs its own parts. */
export function formatWith(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(value);
  if (!d) return "—";
  const dateOnly = typeof value === "string" && CALENDAR_DATE.test(value);
  const timeZone = dateOnly ? "UTC" : zone;
  try {
    return new Intl.DateTimeFormat(currentLocale(), { ...options, timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat(currentLocale(), options).format(d);
  }
}

export const formatDate = (value: string | Date | null | undefined) =>
  formatWith(value, { year: "numeric", month: "numeric", day: "numeric" });

export const formatDateTime = (value: string | Date | null | undefined) =>
  formatWith(value, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const formatTime = (value: string | Date | null | undefined) =>
  formatWith(value, { hour: "numeric", minute: "2-digit" });
