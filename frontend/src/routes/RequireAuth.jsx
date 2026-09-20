import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../features/auth/useAuth";
import AuthStatus from "../features/auth/AuthStatus";

export default function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "anonymous") {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search + location.hash }} />;
  }
  if (status !== "authenticated") return <AuthStatus />;
  return <Outlet />;
}
