import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { useRegistrationResource } from "../hooks/useRegistrationResource";
import RegistrationForm from "../components/RegistrationForm";
import { useEventRegistration } from "../hooks/useEventRegistration";
import { getRegistrationAvailability, registrationAvailabilityLabel } from "../registrationAvailability";
import { useRegistrationWindow } from "../useRegistrationWindow";
import RegistrationWindowNotice from "../components/RegistrationWindowNotice";

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function EventDetailPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { data, receivedAt, error: eventError, refresh } = useRegistrationResource(`/api/events/${eventId}`);
  const event = data?.event;
  const availability = event ? getRegistrationAvailability(event) : null;
  const windowState = useRegistrationWindow(event, data?.server_time, receivedAt, refresh);
  const [registeredEventId, setRegisteredEventId] = useState(null);
  const registered = registeredEventId === eventId;
  const { register, busy, error: regError } = useEventRegistration();

  useEffect(() => {
    if (!registered) return;
    const timer = setTimeout(() => navigate("/registrations/me"), 1500);
    return () => clearTimeout(timer);
  }, [registered, navigate]);

  async function handleSubmit(registrationData) {
    const result = await register(eventId, registrationData);
    if (result) {
      setRegisteredEventId(eventId);
    }
  }

  if (eventError) {
    return (
      <section className="card">
        <Link to="/events" className="back-link">Back to events</Link>
        <p className="error" role="alert">{eventError}</p>
      </section>
    );
  }

  if (!event) {
    return <section className="card"><p role="status">Loading event…</p></section>;
  }

  return (
    <section className="card" aria-labelledby="event-title">
      <Link to="/events" className="back-link">Back to events</Link>
      <p className="eyebrow">EVENT</p>
      <h1 id="event-title">{event.name}</h1>
      {event.purpose && <p className="welcome">{event.purpose}</p>}

      <div className="event-meta">
        {event.start_time && (
          <span className="event-meta__item">
            <span className="event-meta__label">Start</span>
            {formatDate(event.start_time)}
          </span>
        )}
        {event.end_time && (
          <span className="event-meta__item">
            <span className="event-meta__label">End</span>
            {formatDate(event.end_time)}
          </span>
        )}
        {event.expected_attendance != null && (
          <span className="event-meta__item">
            <span className="event-meta__label">Registration capacity</span>
            {event.expected_attendance}
          </span>
        )}
        <span className={`event-meta__item${availability.isFull ? " is-full" : ""}`} aria-live="polite">
          <span className="event-meta__label">Availability</span>
          {registrationAvailabilityLabel(event)}
        </span>
      </div>

      {event.description && <p className="event-description">{event.description}</p>}

      <div className="event-register-section">
        <RegistrationWindowNotice event={event} state={windowState} />
        {registered ? (
          <p role="status">You are registered. Taking you to your registrations…</p>
        ) : event.status === "APPROVED" ? (
          <>
            {availability.isFull ? (
              <p role="status">This event is full. Waiting-list redirection is pending implementation.</p>
            ) : (
              <>
                <h2>Register for this event</h2>
                <p>Fill in your details below to secure your spot.</p>
                {regError && <p className="error" role="alert">{regError}</p>}
                <RegistrationForm
                  key={eventId}
                  fields={event.registration_fields ?? []}
                  onSubmit={handleSubmit}
                  busy={busy}
                  disabled={windowState.status !== "open"}
                  disabledReasonId={windowState.hasWindow ? `registration-window-message-${event.id}` : undefined}
                />
              </>
            )}
          </>
        ) : (
          <p>Registration is not currently open for this event.</p>
        )}
      </div>
    </section>
  );
}

export default function EventDetailPageRoute() {
  const { eventId } = useParams();
  return <EventDetailPage key={eventId} />;
}
