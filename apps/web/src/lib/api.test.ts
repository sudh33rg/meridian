import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, send } from "./api";

const respond = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("sends the bearer token and prefixes /api", async () => {
    const fetchMock = respond(200, [{ id: "1" }]);
    vi.stubGlobal("fetch", fetchMock);
    const out = await api<{ id: string }[]>("/projects", "tok");
    expect(out).toEqual([{ id: "1" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("omits Authorization when there is no token", async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal("fetch", fetchMock);
    await api("/auth/login");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("turns server errors into ApiError with status and code", async () => {
    vi.stubGlobal("fetch", respond(409, { error: "Page has changed", code: "conflict" }));
    const err = await api("/pages/1", "t").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: "Page has changed", status: 409, code: "conflict" });
  });

  it("falls back gracefully when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 502, statusText: "Bad Gateway" })),
    );
    await expect(api("/x", "t")).rejects.toMatchObject({
      status: 502,
      code: "unknown",
      message: "Bad Gateway",
    });
  });

  it("returns undefined for 204 and JSON-encodes bodies in send()", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await send("/issues/1", "t", "PATCH", { status: "done" })).toBeUndefined();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH", body: '{"status":"done"}' });
  });
});
