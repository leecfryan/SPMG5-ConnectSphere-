import { Link } from "react-router";
import { useRegistrationResource } from "../hooks/useRegistrationResource";

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function EventListPage() {
  const { data, error } = useRegistrationResource("/api/events");
  const events = data?.events;

  return (
    <section className="card" aria-labelledby="events-title">
      <Link to="/" className="back-link">Back to workspace</Link>
      <p className="eyebrow">EVENTS</p>
      <h1 id="events-title">Open for registration</h1>
      {error ? (
        <p className="error" role="alert">{error}</p>
      ) : !events ? (
        <p role="status">Loading events…</p>
      ) : events.length === 0 ? (
        <p>No events are currently open for registration.</p>
      ) : (
        <ul className="event-list" aria-label="Available events">
          {events.map((event) => (
            <li key={event.id}>
              <Link to={`/events/${event.id}`} className="event-list__item">
                <span className="event-list__name">{event.name}</span>
                {event.start_time && (
                  <span className="event-list__date">{formatDate(event.start_time)}</span>
                )}
                {event.description && (
                  <p className="event-list__desc">{event.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
