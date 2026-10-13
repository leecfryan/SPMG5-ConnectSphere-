import { Link } from "react-router";
import { useRegistrations } from "../hooks/useRegistrations";
import RegistrationCard from "../components/RegistrationCard";
import WaitlistOffer from "../components/WaitlistOffer";
import WaitlistEntry from "../components/WaitlistEntry";

export default function MyRegistrationsPage() {
  const { registrations, offers, waitlist = [], error, loading, reload } = useRegistrations();
  const hasItems = registrations.length > 0 || offers.length > 0 || waitlist.length > 0;

  return (
    <section className="card my-registrations-page" aria-labelledby="my-regs-title">
      <Link to="/" className="back-link">Back to workspace</Link>
      <p className="eyebrow">REGISTRATION</p>
      <h1 id="my-regs-title">My registrations</h1>
      <p className="my-registrations-page__intro">Your registrations, waitlist places and offers are collected here.</p>
      {error ? (
        <>
          <p className="error" role="alert">{error}</p>
          <button className="secondary" onClick={reload}>Try again</button>
        </>
      ) : loading ? (
        <p role="status">Loading your registrations…</p>
      ) : !hasItems ? (
        <>
          <p>You have not registered for any events yet.</p>
          <Link to="/events" className="btn btn-primary">Browse events</Link>
        </>
      ) : (
        <>
          <div className="my-registrations-summary" aria-label="Registration summary">
            <div><strong>{registrations.length}</strong><span>Registrations</span></div>
            <div><strong>{offers.length}</strong><span>Places offered</span></div>
            <div><strong>{waitlist.length}</strong><span>Waitlists</span></div>
          </div>
          <ul className="registration-list">
            {registrations.map((reg) => (
              <RegistrationCard key={reg.id} registration={reg} />
            ))}
            {offers.map((offer) => (
              <li key={offer.id}>
                <WaitlistOffer
                  offer={offer}
                  onAccepted={reload}
                  onRemoved={reload}
                />
              </li>
            ))}
            {waitlist.map((entry) => (
              <li key={entry.id}>
                <WaitlistEntry entry={entry} onWithdrawn={reload} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
