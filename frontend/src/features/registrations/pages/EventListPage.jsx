import { Link } from "react-router";
import { useRegistrationResource } from "../hooks/useRegistrationResource";
import { getRegistrationAvailability, registrationAvailabilityLabel } from "../registrationAvailability";
import { useRegistrationWindow } from "../useRegistrationWindow";
import RegistrationWindowNotice from "../components/RegistrationWindowNotice";

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function EventListPage() {
  const { data, error } = useRegistrationResource("/api/events");
  const { data: windowData, receivedAt, refresh } = useRegistrationResource("/api/events/registration-windows");
  const events = data?.events;
  const windows = new Map((windowData?.windows ?? []).map((window) => [window.id, window]));

  return (
    <section className="card" aria-labelledby="events-title">
      <Link to="/" className="back-link">Back to workspace</Link>
      <p className="eyebrow">EVENTS</p>
      <h1 id="events-title">Events</h1>
      {error ? (
        <p className="error" role="alert">{error}</p>
      ) : !events ? (
        <p role="status">Loading events…</p>
      ) : events.length === 0 ? (
        <p>No approved events are currently available.</p>
      ) : (
        <ul className="event-list" aria-label="Available events">
          {events.map((event) => {
            const availability = getRegistrationAvailability(event);
            return (
              <EventListItem
                key={event.id}
                event={{ ...event, ...windows.get(event.id) }}
                serverTime={windowData?.server_time}
                serverTimeReceivedAt={receivedAt}
                refreshServerTime={refresh}
                availability={availability}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function EventListItem({ event, serverTime, serverTimeReceivedAt, refreshServerTime, availability }) {
  const windowState = useRegistrationWindow(
    event,
    serverTime,
    serverTimeReceivedAt,
    refreshServerTime,
  );
  return (
    <li>
      <Link to={`/events/${event.id}`} className="event-list__item">
        <span className="event-list__name">{event.name}</span>
        {event.start_time && (
          <span className="event-list__date">{formatDate(event.start_time)}</span>
        )}
        {event.description && (
          <p className="event-list__desc">{event.description}</p>
        )}
        <span className={`event-list__availability${availability.isFull ? " is-full" : ""}`}>
          {registrationAvailabilityLabel(event)}
        </span>
        {!availability.isFull && (
          <RegistrationWindowNotice event={event} state={windowState} showRetry={false} />
        )}
      </Link>
    </li>
  );
}
