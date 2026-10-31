import { useAuth } from "./useAuth";
import SignOutButton from "./SignOutButton";
import "./auth.css";

export default function AuthStatus() {
  const { status, error, retry, hasSession } = useAuth();

  if (status !== "error") {
    return (
      <section className="workspace auth-loading" aria-label="Session status">
        <div className="auth-loading__sidebar" aria-hidden="true">
          <span className="auth-loading__placeholder auth-loading__sidebar-title" />
          {[1, 2, 3, 4].map(item => (
            <div className="auth-loading__nav-item" key={item}>
              <span className="auth-loading__placeholder auth-loading__nav-icon" />
              <span className="auth-loading__placeholder auth-loading__nav-label" />
            </div>
          ))}
        </div>
        <div className="auth-loading__content">
          <div className="auth-loading__heading">
            <div>
              <p className="eyebrow">YOUR CONNECTSPHERE WORKSPACE</p>
              <h1>Getting everything ready</h1>
              <p className="auth-loading__status" role="status">
                <span className="auth-loading__spinner" aria-hidden="true" />
                {status === "loading" ? "Checking your session…" : "Confirming your access…"}
              </p>
            </div>
            {hasSession && <div className="auth-loading__exit"><SignOutButton /></div>}
          </div>
          <div className="auth-loading__preview" aria-hidden="true">
            <div className="auth-loading__banner">
              <span className="auth-loading__placeholder auth-loading__line--short" />
              <span className="auth-loading__placeholder auth-loading__line--title" />
              <span className="auth-loading__placeholder auth-loading__line--description" />
            </div>
            <div className="auth-loading__toolbar">
              <span className="auth-loading__placeholder" />
              <span className="auth-loading__placeholder" />
              <span className="auth-loading__placeholder" />
            </div>
            <div className="auth-loading__cards">
              {[1, 2, 3].map(item => (
                <div className="auth-loading__card" key={item}>
                  <span className="auth-loading__placeholder auth-loading__card-media" />
                  <div className="auth-loading__card-body">
                    <span className="auth-loading__placeholder auth-loading__line--short" />
                    <span className="auth-loading__placeholder auth-loading__line--title" />
                    <span className="auth-loading__placeholder auth-loading__line--description" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card" aria-label="Session status">
      <h1>Let’s reconnect</h1>
      <p className="error" role="alert">{error}</p>
      <button className="primary" onClick={retry}>Try again</button>
      {hasSession && <SignOutButton />}
    </section>
  );
}
