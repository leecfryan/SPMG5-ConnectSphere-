import { Link } from "react-router-dom";
import { useRegistrations } from "../hooks/useRegistrations";
import RegistrationCard from "../components/RegistrationCard";

export default function MyRegistrationsPage() {
  const { registrations, error, loading, reload } = useRegistrations();

  return (
    <section className="card" aria-labelledby="my-regs-title">
      <Link to="/" className="back-link">Back to workspace</Link>
      <p className="eyebrow">REGISTRATION</p>
      <h1 id="my-regs-title">My registrations</h1>
      {error ? (
        <>
          <p className="error" role="alert">{error}</p>
          <button className="secondary" onClick={reload}>Try again</button>
        </>
      ) : loading ? (
        <p role="status">Loading your registrations…</p>
      ) : registrations.length === 0 ? (
        <>
          <p>You have not registered for any events yet.</p>
          <Link to="/events" className="btn btn-primary">Browse events</Link>
        </>
      ) : (
        <ul className="registration-list">
          {registrations.map((reg) => (
            <RegistrationCard key={reg.id} registration={reg} />
          ))}
        </ul>
      )}
    </section>
  );
}
