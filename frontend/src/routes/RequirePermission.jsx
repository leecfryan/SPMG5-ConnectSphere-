import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../features/auth/useAuth";

// Nest under RequireAuth. API handlers must independently enforce the same permission.
export default function RequirePermission({ permission }) {
  const { hasPermission } = useAuth();
  const location = useLocation();
  if (hasPermission(permission)) return <Outlet />;
  return <Navigate to={location.state?.afterSignIn === true ? "/account" : "/forbidden"} replace state={null} />;
}
