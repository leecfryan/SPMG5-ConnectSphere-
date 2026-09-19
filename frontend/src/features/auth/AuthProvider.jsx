import { useEffect, useRef, useState } from "react";
import { getAuthClient } from "../../lib/supabase";
import { AuthContext } from "./useAuth";

const initialAuth = { client: null, session: undefined, revision: 0, problem: "" };

export default function AuthProvider({ children }) {
  const [auth, setAuth] = useState(initialAuth);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const [verification, setVerification] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const signOutPending = useRef(false);
  const { client, session, revision } = auth;
  const token = session?.access_token;

  useEffect(() => {
    let active = true;
    let subscription;
    getAuthClient().then((nextClient) => {
      if (!active) return;
      // Keep this synchronous: invoking async SDK methods here can deadlock refresh.
      subscription = nextClient.auth.onAuthStateChange((_event, nextSession) => {
        if (!active) return;
        setAuth((previous) => ({
          client: nextClient, session: nextSession,
          revision: previous.revision + 1, problem: "",
        }));
        setSignOutError("");
      }).data.subscription;
    }).catch(() => {
      if (active) setAuth((previous) => ({
        ...previous, problem: "We couldn’t connect to sign-in. Please try again.",
      }));
    });
    return () => { active = false; subscription?.unsubscribe(); };
  }, [connectionAttempt]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const stamp = { revision, attempt: verificationAttempt };
    fetch("/api/auth/me", {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401) {
        if (!controller.signal.aborted) setVerification({
          ...stamp, error: "Your session is no longer valid. Please sign out and sign in again.",
        });
        return;
      }
      if (!response.ok) throw new Error("Verification failed");
      const data = await response.json();
      if (!data.user?.id || !Array.isArray(data.user.roles) || !Array.isArray(data.user.accountTypes)) {
        throw new Error("Invalid verified identity");
      }
      if (!controller.signal.aborted) setVerification({
        ...stamp, user: data.user,
        // Missing permissions grant nothing, including when an older backend is running.
        permissions: Array.isArray(data.permissions)
          ? data.permissions.filter((permission) => typeof permission === "string") : [],
      });
    }).catch(() => {
      if (!controller.signal.aborted) setVerification({
        ...stamp, error: "We couldn’t verify your session. Please try again.",
      });
    });
    return () => controller.abort();
  }, [token, revision, verificationAttempt]);

  // Hide stale identity/permissions immediately when a session changes, before effects run.
  const current = verification?.revision === revision && verification?.attempt === verificationAttempt;
  const error = auth.problem || (token && current ? verification.error : "");
  const status = error ? "error"
    : session === undefined ? "loading"
      : !token ? "anonymous"
        : !current ? "verifying" : "authenticated";
  const user = status === "authenticated" ? verification.user : null;
  const permissions = status === "authenticated" ? verification.permissions : [];

  function retry() {
    if (auth.problem) {
      setAuth((previous) => ({ ...initialAuth, revision: previous.revision + 1 }));
      setConnectionAttempt((attempt) => attempt + 1);
    } else {
      setVerificationAttempt((attempt) => attempt + 1);
    }
  }

  async function signOut() {
    if (signOutPending.current || !client) return;
    signOutPending.current = true;
    setSigningOut(true);
    setSignOutError("");
    try {
      const { error: failure } = await client.auth.signOut({ scope: "local" });
      if (failure) throw failure;
      setAuth((previous) => ({ ...previous, session: null, revision: previous.revision + 1 }));
      setVerification(null);
    } catch {
      setSignOutError("We couldn’t sign you out. Check your connection and try again.");
    } finally {
      signOutPending.current = false;
      setSigningOut(false);
    }
  }

  return (
    <AuthContext.Provider value={{
      client, status, user, permissions, error, retry, signOut, signingOut, signOutError,
      hasSession: Boolean(token), token: user ? token : null,
      hasPermission: (permission) => permissions.includes(permission),
    }}>
      {children}
    </AuthContext.Provider>
  );
}
