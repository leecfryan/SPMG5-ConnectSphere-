import { useState } from "react";
import Icon from "../../../components/ui/Icon";
import { Link } from "react-router";
import { useRegistrations } from "../hooks/useRegistrations";
import RegistrationCard from "../components/RegistrationCard";
import WaitlistOffer from "../components/WaitlistOffer";
import WaitlistEntry from "../components/WaitlistEntry";

export default function MyRegistrationsPage() {
  const { registrations, offers, waitlist = [], error, loading, reload } = useRegistrations();
  const [filter, setFilter] = useState("all");
  const visibleRegistrations = registrations.filter(reg => filter === "all" || reg.status === filter);
  const hasItems = registrations.length > 0 || offers.length > 0 || waitlist.length > 0;

  return (
    <section className="card my-registrations-page" aria-labelledby="my-regs-title">
      <Link to="/" className="back-link">Back to workspace</Link>
      <p className="eyebrow">REGISTRATION</p>
      <h1 id="my-regs-title">My registrations</h1>
      <p className="my-registrations-page__intro">Your registrations, waitlist places and offers are collected here.</p>
      <div className="registrations-banner"><Icon name="ticket" size={36} /><div><strong>Good experiences. All in one place.</strong><p>Keep track of your plans, check your status and manage your place.</p></div><Link to="/events" className="btn btn-secondary">Explore events <Icon name="arrow" size={16} /></Link></div>
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
          <div className="registration-filters" role="group" aria-label="Filter registrations">
            {[["all", "All registrations"], ["pending", "Pending"], ["confirmed", "Confirmed"], ["withdrawn", "Withdrawn"]].map(([value, label]) => <button className="registration-filter" key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
          {visibleRegistrations.length === 0 && filter !== "all" && <p className="registration-filter-empty" role="status">No {filter} registrations. Offers and waitlist places are shown below when available.</p>}
          <ul className="registration-list">
            {visibleRegistrations.map((reg) => (
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
