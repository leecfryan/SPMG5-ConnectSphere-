import { useState } from "react";

export default function SignIn({ client }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { error: signInError } = await client.auth.signInWithPassword({
        email: email.trim(), password,
      });
      if (signInError) {
        setError(signInError.status === 429
          ? "Too many sign-in attempts. Please wait a moment and try again."
          : signInError.status >= 500 || !signInError.status
            ? "Sign-in is temporarily unavailable. Please try again."
            : "Unable to sign in. Check your email and password and try again.");
      }
    } catch {
      setError("Unable to connect. Check your connection and try again.");
    } finally {
      setPassword("");
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
        <input id="email" name="email" type="email" autoComplete="username"
          placeholder="you@example.com" maxLength={254} required disabled={busy}
          value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="password">Password</label>
        <div className="password-field">
          <input id="password" name="password" type={visible ? "text" : "password"}
            autoComplete="current-password" required maxLength={1024} disabled={busy}
            value={password} onChange={(event) => setPassword(event.target.value)} />
          <button className="password-toggle" type="button" disabled={busy}
            aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}
            onClick={() => setVisible(!visible)}>{visible ? "Hide" : "Show"}</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="card-note">Use the account provided to you by ConnectSphere.</p>
    </section>
  );
}
