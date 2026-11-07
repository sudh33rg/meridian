import React, { useEffect, useState } from "react";
import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { AuthScreen } from "./features/auth/AuthScreen";
import {
  AcceptInvitePage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from "./features/auth/AuthPages";
import { WorkspaceProvider } from "./features/workspace/useWorkspace";
import { WorkspaceApp } from "./features/workspace/WorkspaceApp";
import { ApiError, SIGNED_OUT_EVENT, api } from "./lib/api";
import { clearSession, loadSession, saveSession, sessionFromMe, type Me } from "./lib/session";
import type { Session } from "./lib/types";

const hasSessionCookie = () => /(^|;\s*)meridian_csrf=/.test(document.cookie);

/** Gate: show sign-in until a session exists, then mount the workspace for that session.
 * The credential itself lives in an HttpOnly cookie; this only keeps the display profile. */
function AppGate() {
  const [session, setSessionState] = useState<Session | null>(() =>
    hasSessionCookie() ? loadSession() : null,
  );
  const [checking, setChecking] = useState(hasSessionCookie());
  const setSession = (s: Session | null) => {
    if (s) saveSession(s);
    else clearSession();
    setSessionState(s);
  };
  useEffect(() => {
    if (!hasSessionCookie()) return;
    let alive = true;
    api<Me>("/me")
      .then((m) => alive && setSession(sessionFromMe(m)))
      .catch((e) => alive && e instanceof ApiError && e.status === 401 && setSession(null))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const out = () => setSession(null);
    window.addEventListener(SIGNED_OUT_EVENT, out);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, out);
  }, []);
  if (checking) return null;
  if (!session) return <AuthScreen onAuthenticated={setSession} />;
  return (
    <WorkspaceProvider session={session} setSession={setSession}>
      <Outlet />
    </WorkspaceProvider>
  );
}

const rootRoute = createRootRoute({ component: Outlet });
const gateRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppGate });
const indexRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/$tab", params: { tab: "overview" } });
  },
});
const tabRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "$tab",
  validateSearch: (s: Record<string, unknown>): { project?: string } => ({
    project: typeof s.project === "string" ? s.project : undefined,
  }),
  component: WorkspaceApp,
});
const forgotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "auth/forgot",
  component: ForgotPasswordPage,
});
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "auth/reset",
  component: ResetPasswordPage,
});
const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "auth/verify",
  component: VerifyEmailPage,
});
const acceptRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "auth/accept",
  component: () => (
    <AcceptInvitePage
      onAuthenticated={(s) => {
        saveSession(s);
        window.location.assign("/");
      }}
    />
  ),
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    gateRoute.addChildren([indexRoute, tabRoute]),
    forgotRoute,
    resetRoute,
    verifyRoute,
    acceptRoute,
  ]),
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
