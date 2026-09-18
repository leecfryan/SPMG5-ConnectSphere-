import { useAuth } from "./useAuth";
import SignOutButton from "./SignOutButton";

export default function AuthStatus() {
  const { status, error, retry, hasSession } = useAuth();
  return (
    <section className="card" aria-label="Session status">
      {status === "error" ? (
        <>
          <h1>Let’s reconnect</h1>
          <p className="error" role="alert">{error}</p>
          <button className="primary" onClick={retry}>Try again</button>
        </>
      ) : <p role="status">{status === "loading" ? "Checking your session…" : "Confirming your access…"}</p>}
      {hasSession && <SignOutButton />}
    </section>
  );
}
