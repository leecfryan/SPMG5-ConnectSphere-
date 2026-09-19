import { useAuth } from "./useAuth";

export default function SignOutButton() {
  const { signOut, signingOut, signOutError } = useAuth();
  return (
    <>
      {signOutError && <p className="error" role="alert">{signOutError}</p>}
      <button className="secondary" disabled={signingOut} onClick={signOut}>
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </>
  );
}
