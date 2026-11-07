import { describe, expect, it } from "vitest";
import { clearSession, loadSession, saveSession } from "./session";
import type { Session } from "./types";

const s: Session = {
  token: "t".repeat(64),
  tenant_id: "a",
  user_id: "b",
  organization: "Acme",
  name: "Alex",
};

describe("session storage", () => {
  it("round-trips and clears", () => {
    expect(loadSession()).toBeNull();
    saveSession(s);
    expect(loadSession()).toEqual(s);
    clearSession();
    expect(loadSession()).toBeNull();
  });
  it("ignores corrupt or token-less values", () => {
    sessionStorage.setItem("meridian.session", "{not json");
    expect(loadSession()).toBeNull();
    sessionStorage.setItem("meridian.session", JSON.stringify({ name: "x" }));
    expect(loadSession()).toBeNull();
  });
});
