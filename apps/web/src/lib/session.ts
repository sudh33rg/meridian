import type { Session } from "./types";

const KEY = "meridian.session";

export function loadSession(storage: Storage = sessionStorage): Session | null {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || "null");
    return raw && typeof raw.token === "string" ? (raw as Session) : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session, storage: Storage = sessionStorage) {
  storage.setItem(KEY, JSON.stringify(s));
}
export function clearSession(storage: Storage = sessionStorage) {
  storage.removeItem(KEY);
}
