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

/** The signed-in profile as reported by `/api/me` (used to restore a session from the cookie). */
export type Me = {
  user_id: string;
  email: string;
  name: string;
  tenant_id: string;
  tenant: string;
  slug: string;
  role: string;
  email_verified: boolean;
};
export const sessionFromMe = (m: Me): Session => ({
  token: "",
  refresh_token: "",
  tenant_id: m.tenant_id,
  user_id: m.user_id,
  organization: m.tenant,
  name: m.name,
});
