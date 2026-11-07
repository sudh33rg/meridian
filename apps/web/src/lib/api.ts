/** The only place that talks HTTP to the Meridian API. */
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

export async function api<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(
      body.error || response.statusText || "Request failed",
      response.status,
      body.code || "unknown",
    );
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const send = <T>(path: string, token: string, method: string, body?: unknown) =>
  api<T>(path, token, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Request failed");

/** `api` with the token first, for call sites that always have a session. */
export const request = <T>(token: string, path: string, init?: RequestInit) => api<T>(path, token, init);
