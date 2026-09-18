import { useAuth } from "../features/auth/useAuth";

const roleLabels = {
  event_coordinator: "Event Coordinator", venue_staff: "Venue Staff",
  technical_support_staff: "Technical Support Staff", event_organiser: "Event Organiser",
  attendee: "Attendee", event_ops_manager: "Event Operations Manager",
};

export default function AccountPage() {
  const { user } = useAuth();
  return (
    <section className="card" aria-labelledby="account-title">
      <p className="eyebrow">YOUR WORKSPACE</p>
      <h1 id="account-title">You’re signed in</h1>
      <p className="welcome">Welcome, {user.fullName || user.email}.</p>
      <dl className="account-details">
        <div><dt>Email</dt><dd>{user.email}</dd></div>
        <div><dt>Account</dt><dd>{user.accountTypes.map((type) => type === "internal" ? "Internal staff" : "External user").join(" · ") || "Account setup pending"}</dd></div>
        <div><dt>Role</dt><dd>{user.roles.map((role) => roleLabels[role]).join(" · ") || "Not assigned"}</dd></div>
      </dl>
      <p className="card-note">Your account is ready. Event features will appear here as they become available.</p>
    </section>
  );
}
