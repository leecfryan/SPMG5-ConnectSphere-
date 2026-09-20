import { useRef, useState } from "react";
import { SIGN_IN_LIMITS, signInWithCredentials } from "./signInService";

export default function SignIn({ client }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      setError(await signInWithCredentials(client, { email, password }));
    } finally {
      setPassword("");
      setVisible(false);
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="sign-in-title">
      <div className="card-heading">
        <p className="eyebrow">YOUR CONNECTSPHERE ACCOUNT</p>
        <h1 id="sign-in-title">Welcome back</h1>
        <p>Sign in to access your event workspace.</p>
      </div>
      <form onSubmit={submit} aria-busy={busy}>
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          maxLength={SIGN_IN_LIMITS.email}
          required
          disabled={busy}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="password">Password</label>
        <div className="password-field">
          <input
            id="password"
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            required
            maxLength={SIGN_IN_LIMITS.password}
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            className="password-toggle"
            type="button"
            disabled={busy}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? "Hide" : "Show"}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="card-note">
        Use the account provided to you by ConnectSphere.
      </p>
    </section>
  );
}
