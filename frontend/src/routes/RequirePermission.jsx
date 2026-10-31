import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../features/auth/useAuth";

// Nest under RequireAuth. API handlers must independently enforce the same permission.
export default function RequirePermission({ permission }) {
  const { hasPermission, signInReturnKey } = useAuth();
  const location = useLocation();
  if (hasPermission(permission)) return <Outlet />;
  const afterSignIn = typeof signInReturnKey === "string" && location.state?.afterSignIn === signInReturnKey;
  return <Navigate to={afterSignIn ? "/account" : "/forbidden"} replace state={null} />;
}
