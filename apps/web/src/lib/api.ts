/** The only place that talks HTTP to the Meridian API.
 *
 * Browser mode: when no bearer token is given the client runs in cookie mode. The server keeps
 * the session in HttpOnly cookies (invisible to this code); unsafe requests echo the readable
 * `meridian_csrf` cookie in `X-CSRF-Token`. A 401 triggers one transparent refresh-token
 * rotation and a single retry; if that fails the app is told to sign out. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const API_BASE = "/api";
export const SIGNED_OUT_EVENT = "meridian:signed-out";
/** Fired when the workspace requires MFA and the member has not set it up yet. */
export const MFA_REQUIRED_EVENT = "meridian:mfa-required";

const csrfToken = () => {
  if (typeof document === "undefined") return undefined;
  const hit = document.cookie.split("; ").find((c) => c.startsWith("meridian_csrf="));
  return hit ? decodeURIComponent(hit.slice("meridian_csrf=".length)) : undefined;
};
const isSafe = (method?: string) => !method || ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

let refreshing: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const csrf = csrfToken();
      const r = await fetch(API_BASE + "/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Mode": "cookie",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: "{}",
      });
      return r.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

/** One authenticated call with CSRF echo, a single transparent refresh and typed errors. Returns
 * the successful response so callers can read headers such as `X-Next-Cursor` and `ETag`. */
export async function apiResponse(path: string, token?: string, init?: RequestInit): Promise<Response> {
  const cookieMode = !token;
  const send = () => {
    const csrf = cookieMode && !isSafe(init?.method) ? csrfToken() : undefined;
    return fetch(API_BASE + path, {
      ...init,
      credentials: "same-origin",
      headers: {
        // FormData sets its own multipart boundary header.
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: "Bearer " + token } : { "X-Auth-Mode": "cookie" }),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...init?.headers,
      },
    });
  };
  let response = await send();
  if (response.status === 401 && cookieMode && !path.startsWith("/auth/")) {
    if (await refreshSession()) response = await send();
    else if (typeof window !== "undefined") window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    if (body.code === "mfa_setup_required" && typeof window !== "undefined")
      window.dispatchEvent(new Event(MFA_REQUIRED_EVENT));
    throw new ApiError(
      body.error || response.statusText || "Request failed",
      response.status,
      body.code || "unknown",
    );
  }
  return response;
}

export async function api<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await apiResponse(path, token, init);
  if (response.status === 204) return undefined as T;
  // 202 and friends may legitimately carry no body.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** `request` that also returns the response headers. */
export async function requestWithHeaders<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ data: T; headers: Headers }> {
  const response = await apiResponse(path, token, init);
  const text = response.status === 204 ? "" : await response.text();
  return { data: (text ? JSON.parse(text) : undefined) as T, headers: response.headers };
}

/** A fresh `Idempotency-Key`. `randomUUID` needs a secure context, so fall back to random hex on
 * plain-HTTP origins such as a LAN address. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

export const send = <T>(path: string, token: string, method: string, body?: unknown) =>
  api<T>(path, token, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Request failed");

/** `api` with the token first, for call sites that always have a session. */
export const request = <T>(token: string, path: string, init?: RequestInit) => api<T>(path, token, init);
