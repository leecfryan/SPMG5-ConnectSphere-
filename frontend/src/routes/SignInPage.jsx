import { Navigate, useLocation } from "react-router";
import { useAuth } from "../features/auth/useAuth";
import AuthStatus from "../features/auth/AuthStatus";
import SignIn from "../features/auth/SignIn";

function returnPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || [...value].some((character) => character.charCodeAt(0) <= 32)) {
    return "/account";
  }
  const destination = new URL(value, "https://app.invalid");
  const pathname = destination.pathname.replace(/\/+$/, "").toLowerCase();
  if (pathname === "/sign-in" || pathname === "/forbidden") return "/account";
  return destination.pathname + destination.search + destination.hash;
}

export default function SignInPage() {
  const { status, client } = useAuth();
  const location = useLocation();
  if (status === "authenticated") return <Navigate to={returnPath(location.state?.from)} replace state={{ afterSignIn: true }} />;
  if (status !== "anonymous") return <AuthStatus />;
  return <SignIn client={client} />;
}
