import { useEffect, useState } from "react";
import { Routes, Route, Navigate, NavLink, Outlet, Link } from "react-router-dom";
import { getAuthClient } from "./lib/supabase";
import { AuthContext, useAuth } from "./lib/auth";
import SignIn from "./features/auth/SignIn";
import StaffResponsibilities from "./features/auth/StaffResponsibilities";
import EventListPage from "./features/registrations/pages/EventListPage";
import EventDetailPage from "./features/registrations/pages/EventDetailPage";
import MyRegistrationsPage from "./features/registrations/pages/MyRegistrationsPage";
import RegistrationDetailPage from "./features/registrations/pages/RegistrationDetailPage";
import "./App.css";

const roleLabels = {
  event_coordinator: "Event Coordinator",
  venue_staff: "Venue Staff",
  technical_support_staff: "Technical Support Staff",
  event_organiser: "Event Organiser",
  attendee: "Attendee",
};

export default function App() {
  const [client, setClient] = useState(null);
  const [session, setSession] = useState(undefined);
  const [problem, setProblem] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let subscription;
    getAuthClient().then((auth) => {
      if (!active) return;
      setClient(auth);
      subscription = auth.auth.onAuthStateChange((_event, nextSession) => {
        if (active) setSession(nextSession);
      }).data.subscription;
    }).catch(() => {
      if (active) setProblem("We couldn't connect to sign-in. Please try again.");
    });
    return () => { active = false; subscription?.unsubscribe(); };
  }, [attempt]);

  // Sign-in layout — original two-column design
  if (!session) {
    return (
      <div className="app-shell">
        <header className="brand"><span className="brand-mark" aria-hidden="true">C</span>ConnectSphere</header>
        <main>
          <aside className="intro">
            <p className="eyebrow">EVENT PLANNING & VENUE BOOKING</p>
            <h2>Great events.<br />Connected people.</h2>
            <p>One place for the people and arrangements that bring an event together.</p>
            <div className="intro-line" aria-hidden="true" />
            <span className="intro-caption">From the first idea to the final detail.</span>
          </aside>
          {problem ? (
            <section className="card" aria-label="Connection error">
              <h1>Let's reconnect</h1>
              <p className="error" role="alert">{problem}</p>
              <button className="primary" onClick={() => { setProblem(""); setAttempt(attempt + 1); }}>Try again</button>
            </section>
          ) : session === undefined ? (
            <section className="card"><p role="status">Checking your session…</p></section>
          ) : (
            <SignIn client={client} />
          )}
        </main>
        <footer>ConnectSphere Event Services</footer>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ token: session.access_token, client }}>
      <Routes>
        {/* Account page keeps the original layout */}
        <Route path="/" element={<AccountPage session={session} />} />
        {/* Registration and events pages use the app shell */}
        <Route element={<AppShell />}>
          <Route path="/events" element={<EventListPage />} />
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/registrations/me" element={<MyRegistrationsPage />} />
          <Route path="/registrations/me/:registrationId" element={<RegistrationDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}

function AccountPage({ session }) {
  return (
    <div className="app-shell">
      <header className="brand"><span className="brand-mark" aria-hidden="true">C</span>ConnectSphere</header>
      <main>
        <aside className="intro">
          <p className="eyebrow">EVENT PLANNING & VENUE BOOKING</p>
          <h2>Great events.<br />Connected people.</h2>
          <p>One place for the people and arrangements that bring an event together.</p>
          <div className="intro-line" aria-hidden="true" />
          <span className="intro-caption">From the first idea to the final detail.</span>
        </aside>
        <Account key={session.access_token} />
      </main>
      <footer>ConnectSphere Event Services</footer>
    </div>
  );
}

function AppShell() {
  return (
    <div className="app-shell app-shell--app">
      <header className="app-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">C</span>ConnectSphere</div>
        <AppNav />
      </header>
      <div className="app-content">
        <Outlet />
      </div>
      <footer>ConnectSphere Event Services</footer>
    </div>
  );
}

function AppNav() {
  const { client } = useAuth();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      // session expires naturally
    } finally {
      setBusy(false);
    }
  }

  const navClass = ({ isActive }) => isActive ? "app-nav__link app-nav__link--active" : "app-nav__link";

  return (
    <nav className="app-nav" aria-label="Main navigation">
      <NavLink to="/events" className={navClass}>Events</NavLink>
      <NavLink to="/registrations/me" className={navClass}>Registrations</NavLink>
      <button className="app-nav__signout" disabled={busy} onClick={signOut}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </nav>
  );
}

function Account() {
  const { token, client } = useAuth();
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/me", {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401) {
        if (!controller.signal.aborted) setError("Your session is no longer valid. Please sign out and sign in again.");
        return;
      }
      if (!response.ok) throw new Error("Unable to verify your session.");
      const data = await response.json();
      if (!controller.signal.aborted) setUser(data.user);
    }).catch((failure) => {
      if (failure.name !== "AbortError") setError("We couldn't verify your session. Please try again.");
    });
    return () => controller.abort();
  }, [token, attempt]);

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const { error: failure } = await client.auth.signOut({ scope: "local" });
      if (failure) throw failure;
    } catch {
      setError("We couldn't sign you out. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="account-title">
      <p className="eyebrow">YOUR WORKSPACE</p>
      <h1 id="account-title">{user ? "You're signed in" : "Verifying your account"}</h1>
      {user ? (
        <>
          <p className="welcome">Welcome, {user.fullName || user.email}.</p>
          <dl className="account-details">
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Account</dt><dd>{user.accountTypes.map((type) => type === "internal" ? "Internal staff" : "External user").join(" · ") || "Account setup pending"}</dd></div>
            <div><dt>Role</dt><dd>{user.roles.map((role) => roleLabels[role]).join(" · ") || "Not assigned"}</dd></div>
          </dl>
          {user.accountTypes.includes("internal") && <StaffResponsibilities token={token} />}
          <nav className="workspace-nav" aria-label="Quick links">
            <Link to="/events" className="btn btn-primary">Browse events</Link>
            <Link to="/registrations/me" className="btn btn-secondary">My registrations</Link>
          </nav>
          <p className="card-note">Your account is ready. Event features will appear here as they become available.</p>
        </>
      ) : !error && <p role="status">Confirming your access…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {error && !user && <button className="primary" onClick={() => { setError(""); setAttempt(attempt + 1); }}>Try again</button>}
      <button className="secondary" disabled={busy} onClick={signOut}>{busy ? "Signing out…" : "Sign out"}</button>
    </section>
  );
}
