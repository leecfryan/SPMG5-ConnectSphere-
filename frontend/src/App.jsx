import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import AuthProvider from "./features/auth/AuthProvider";
import AuthStatus from "./features/auth/AuthStatus";
import { useAuth } from "./features/auth/useAuth";
import RequireAuth from "./routes/RequireAuth";
import RequirePermission from "./routes/RequirePermission";
import SignInPage from "./routes/SignInPage";
import AccountPage from "./routes/AccountPage";
import ResponsibilitiesPage from "./routes/ResponsibilitiesPage";
import WorkspaceLayout from "./routes/WorkspaceLayout";
import EquipmentRequestPage from "./features/equipment/pages/EquipmentRequestPage";
import TechnicalSupportDashboardPage from "./features/equipment/pages/TechnicalSupportDashboardPage";
import VenueRoutes from "./features/venues/VenueRoutes";
import EventRequestPage from "./features/events/pages/EventRequestPage";
import EventListPage from "./features/registrations/pages/EventListPage";
import EventDetailPage from "./features/registrations/pages/EventDetailPage";
import MyRegistrationsPage from "./features/registrations/pages/MyRegistrationsPage";
import RegistrationDetailPage from "./features/registrations/pages/RegistrationDetailPage";
import "./features/registrations/registrations.css";
import "./App.css";

function Home() {
  const { status } = useAuth();
  if (status === "anonymous") return <Navigate to="/sign-in" replace />;
  if (status === "authenticated") return <Navigate to="/account" replace />;
  return <AuthStatus />;
}

export default function App() {
  const location = useLocation();
  const fullWorkspace = location.pathname === "/venues" || location.pathname.startsWith("/venues/") || location.pathname.startsWith("/equipment/") || location.pathname === "/technical-support";
  return (
    <AuthProvider>
      <div className="app-shell">
        <header className="brand"><span className="brand-mark" aria-hidden="true">C</span>ConnectSphere</header>
        <main className={fullWorkspace ? "venue-workspace" : location.pathname === "/events/new" ? "wide" : undefined}>
          <aside className="intro">
            <p className="eyebrow">EVENT PLANNING & VENUE BOOKING</p>
            <h2>Great events.<br />Connected people.</h2>
            <p>One place for the people and arrangements that bring an event together.</p>
            <div className="intro-line" aria-hidden="true" />
            <span className="intro-caption">From the first idea to the final detail.</span>
          </aside>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/sign-in" element={<SignInPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<WorkspaceLayout />}>
                <Route path="/events" element={<EventListPage />} />
                <Route path="/events/:eventId" element={<EventDetailPage />} />
                <Route path="/registrations/me" element={<MyRegistrationsPage />} />
                <Route path="/registrations/me/:registrationId" element={<RegistrationDetailPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route element={<RequirePermission permission="events.submit" />}>
                  <Route path="/events/new" element={<EventRequestPage />} />
                </Route>
                <Route element={<RequirePermission permission="internal.access" />}>
                  <Route element={<RequirePermission permission="venues.read" />}>
                    <Route path="/venues/*" element={<VenueRoutes />} />
                  </Route>
                  <Route element={<RequirePermission permission="equipment.request" />}>
                    <Route path="/equipment/requests" element={<EquipmentRequestPage />} />
                  </Route>
                  <Route element={<RequirePermission permission="equipment.review" />}>
                    <Route path="/technical-support" element={<TechnicalSupportDashboardPage />} />
                  </Route>
                  <Route path="/staff/responsibilities" element={<ResponsibilitiesPage />} />
                </Route>
                <Route path="/forbidden" element={
                  <section className="card"><h1>Access denied</h1><p>You do not have permission to view this page.</p><Link to="/account">Return to your account</Link></section>
                } />
              </Route>
            </Route>
            <Route path="*" element={
              <section className="card"><h1>Page not found</h1><p>This page does not exist.</p><Link to="/">Go to home</Link></section>
            } />
          </Routes>
        </main>
        <footer>ConnectSphere Event Services</footer>
      </div>
    </AuthProvider>
  );
}
