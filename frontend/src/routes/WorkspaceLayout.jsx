import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useAuth } from "../features/auth/useAuth";
import Icon from "../components/ui/Icon";
import SignOutButton from "../features/auth/SignOutButton";

export default function WorkspaceLayout() {
  const { hasPermission } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`workspace${collapsed ? " workspace--collapsed" : ""}`}>
      <div className="workspace-sidebar">
        <nav className="workspace-nav" id="workspace-navigation" aria-label="Workspace">
          <div className="workspace-nav__heading">
            <span className="workspace-nav__label">WORKSPACE</span>
            <button className="workspace-collapse" type="button" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="workspace-navigation"><Icon name={collapsed ? "panelOpen" : "panelClose"} size={18} /></button>
          </div>
          <NavLink to="/account" aria-label="Account"><Icon name="account" /><span>Account</span></NavLink>
          <NavLink to="/notifications" aria-label="Notifications"><Icon name="bell" /><span>Notifications</span></NavLink>
          {hasPermission("events.browse") && <NavLink to="/events" aria-label="Browse events"><Icon name="compass" /><span>Browse events</span></NavLink>}
          {hasPermission("registrations.manage") && <NavLink to="/registrations/me" aria-label="My registrations"><Icon name="ticket" /><span>My registrations</span></NavLink>}
          {hasPermission("events.managed.read") && <NavLink to="/events/managed" aria-label="My Events"><Icon name="calendar" /><span>My Events</span></NavLink>}
          {hasPermission("events.own.read") && <NavLink to="/my-event-requests" aria-label="My event requests"><Icon name="request" /><span>My event requests</span></NavLink>}
          {hasPermission("events.assigned.read") && <NavLink to="/assigned-events" aria-label="My assigned events"><Icon name="calendar" /><span>My assigned events</span></NavLink>}
          {hasPermission("events.review") && <NavLink to="/event-management" aria-label="Manage event requests"><Icon name="grid" /><span>Manage event requests</span></NavLink>}
          {hasPermission("events.submit") && <NavLink to="/events/new" aria-label="New event request"><Icon name="plus" /><span>New event request</span></NavLink>}
          {hasPermission("internal.access") && hasPermission("events.assign_coordinator") && <NavLink to="/events/assignments" aria-label="Assign coordinators"><Icon name="account" /><span>Assign coordinators</span></NavLink>}
          {hasPermission("internal.access") && hasPermission("equipment.request") && <NavLink to="/equipment/requests" aria-label="Request equipment"><Icon name="grid" /><span>Request equipment</span></NavLink>}
          {/* Scrum-30: catalogue is Technical Support Staff only now - equipment.review, not equipment.read. */}
          {hasPermission("internal.access") && hasPermission("equipment.review") && <NavLink to="/equipment/catalogue" aria-label="Equipment catalogue"><Icon name="grid" /><span>Equipment catalogue</span></NavLink>}
          {hasPermission("internal.access") && hasPermission("equipment.review") && <NavLink to="/technical-support" aria-label="Technical support"><Icon name="grid" /><span>Technical support</span></NavLink>}
          {hasPermission("internal.access") && hasPermission("venues.read") && <NavLink to="/venues" aria-label="Venues"><Icon name="pin" /><span>Venues</span></NavLink>}
          {hasPermission("internal.access") && hasPermission("events.safety.read") && <NavLink to="/safety-reviews" aria-label="Safety reviews"><Icon name="shield" /><span>Safety reviews</span></NavLink>}
          {hasPermission("internal.access") && <NavLink to="/staff/responsibilities" aria-label="Responsibilities"><Icon name="shield" /><span>Responsibilities</span></NavLink>}
        </nav>
        <div className="workspace-session"><span>Connected. All in one place.</span><SignOutButton /></div>
      </div>
      <div className="workspace-content" id="workspace-content" tabIndex={-1}><Outlet /></div>
    </div>
  );
}
