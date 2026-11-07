import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthScreen } from "./AuthScreen";

afterEach(() => vi.unstubAllGlobals());

describe("AuthScreen", () => {
  it("signs up and reports the session", async () => {
    const session = {
      token: "x".repeat(64),
      tenant_id: "t",
      user_id: "u",
      organization: "Acme",
      name: "Alex",
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(session), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuth = vi.fn();
    render(<AuthScreen onAuthenticated={onAuth} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Acme Studio"), "Acme");
    await user.type(screen.getByPlaceholderText("Alex Morgan"), "Alex");
    await user.type(screen.getByPlaceholderText("acme-studio"), "ACME-Studio");
    await user.type(screen.getByPlaceholderText("alex@company.com"), "alex@acme.test");
    await user.type(screen.getByPlaceholderText("At least 12 characters"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: /create workspace/i }));
    await waitFor(() => expect(onAuth).toHaveBeenCalledWith(session));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/signup");
    expect(JSON.parse(init.body)).toMatchObject({ slug: "acme-studio", email: "alex@acme.test" });
  });

  it("shows the server error and stays on the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Invalid credentials", code: "unauthorized" }), {
          status: 401,
        }),
      ),
    );
    const onAuth = vi.fn();
    render(<AuthScreen onAuthenticated={onAuth} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.type(screen.getByPlaceholderText("acme-studio"), "acme");
    await user.type(screen.getByPlaceholderText("alex@company.com"), "a@b.test");
    await user.type(screen.getByPlaceholderText("At least 12 characters"), "whatever");
    await user.click(screen.getAllByRole("button", { name: /sign in/i }).at(-1)!);
    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(onAuth).not.toHaveBeenCalled();
  });
});
