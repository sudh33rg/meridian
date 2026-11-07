import React, { useState } from "react";
import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { AuthScreen } from "./features/auth/AuthScreen";
import { WorkspaceProvider } from "./features/workspace/useWorkspace";
import { WorkspaceApp } from "./features/workspace/WorkspaceApp";
import { clearSession, loadSession, saveSession } from "./lib/session";
import type { Session } from "./lib/types";

/** Gate: show sign-in until a session exists, then mount the workspace for that session. */
function Root() {
  const [session, setSessionState] = useState<Session | null>(() => loadSession());
  const setSession = (s: Session | null) => {
    if (s) saveSession(s);
    else clearSession();
    setSessionState(s);
  };
  if (!session) return <AuthScreen onAuthenticated={setSession} />;
  return (
    <WorkspaceProvider session={session} setSession={setSession}>
      <Outlet />
    </WorkspaceProvider>
  );
}

const rootRoute = createRootRoute({ component: Root });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/$tab", params: { tab: "overview" } });
  },
});
const tabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$tab",
  validateSearch: (s: Record<string, unknown>): { project?: string } => ({
    project: typeof s.project === "string" ? s.project : undefined,
  }),
  component: WorkspaceApp,
});

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, tabRoute]) });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
