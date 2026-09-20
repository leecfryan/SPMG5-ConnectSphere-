import { Navigate, Outlet } from "react-router";
import { useAuth } from "../features/auth/useAuth";

// Nest under RequireAuth. API handlers must independently enforce the same permission.
export default function RequirePermission({ permission }) {
  const { hasPermission } = useAuth();
  return hasPermission(permission) ? <Outlet /> : <Navigate to="/forbidden" replace />;
}
