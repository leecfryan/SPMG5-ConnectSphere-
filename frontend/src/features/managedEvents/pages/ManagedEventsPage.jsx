import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { fetchManagedEvents } from "../managedEventsService";
import "../../events/events.css";

// Result state is keyed by token, so signing out or switching accounts drops the
// previous list before the next request settles.
export default function ManagedEventsPage() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;
    fetchManagedEvents(token)
      .then((events) => { if (active) setResult({ token, events }); })
      .catch((error) => { if (active) setResult({ token, events: [], error: error.message }); });
    return () => { active = false; };
  }, [token]);

  const events = result?.token === token ? result.events : null;
  const error = result?.token === token ? result.error : "";

  return (
    <section className="card" aria-labelledby="managed-events-title">
      <p className="eyebrow">EVENTS</p>
      <h1 id="managed-events-title">My Events</h1>
      <p>Events you submitted as an organiser, or that were assigned to you as a coordinator.</p>

      {error ? (
        <>
          <p className="error" role="alert">{error}</p>
          <Link to="/account">Back to your account</Link>
        </>
      ) : !events ? (
        <p role="status">Loading your events…</p>
      ) : events.length === 0 ? (
        <p>You do not own or manage any events yet.</p>
      ) : (
        <ul className="event-list" aria-label="Events you manage">
          {events.map((event) => (
            <li key={event.id}>
              <Link to={`/events/managed/${event.id}`} className="event-list__item">
                <span className="event-list__name">{event.name}</span>
                {event.start_time && (
                  <span className="event-list__date">{formatDate(event.start_time)}</span>
                )}
                <span className="event-list__desc">
                  {event.status} · {event.enrolled}/{event.maxEnrollment ?? "-"} registered
                  {isAtCapacity(event) && " · Full"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function isAtCapacity(event) {
  return Number.isInteger(event.maxEnrollment) && event.enrolled >= event.maxEnrollment;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
