import { NavLink, Outlet } from "react-router";
import { useAuth } from "../features/auth/useAuth";
import SignOutButton from "../features/auth/SignOutButton";

export default function WorkspaceLayout() {
  const { hasPermission } = useAuth();
  return (
    <div className="workspace">
      <nav className="workspace-nav" aria-label="Workspace">
        <NavLink to="/account">Account</NavLink>
        {hasPermission("events.submit") && <NavLink to="/events/new">New event request</NavLink>}
        {hasPermission("internal.access") && <NavLink to="/staff/responsibilities">Responsibilities</NavLink>}
      </nav>
      <Outlet />
      <SignOutButton />
    </div>
  );
}
