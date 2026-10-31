import { useAuth } from "./useAuth";
import Icon from "../../components/ui/Icon";

export default function SignOutButton() {
  const { signOut, signingOut, signOutError } = useAuth();

  return (
    <>
      {signOutError && <p className="error" role="alert">{signOutError}</p>}
      <button className="secondary sign-out" aria-label={signingOut ? "Signing out…" : "Sign out"} disabled={signingOut} onClick={signOut}>
        <Icon name="logout" size={18} /><span>{signingOut ? "Signing out…" : "Sign out"}</span>
      </button>
    </>
  );
}
