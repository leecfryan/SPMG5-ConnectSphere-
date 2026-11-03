import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { useRegistrationResource } from "../hooks/useRegistrationResource";
import Icon from "../../../components/ui/Icon";
import RegistrationForm from "../components/RegistrationForm";
import { useEventRegistration } from "../hooks/useEventRegistration";
import { getRegistrationAvailability, registrationAvailabilityLabel } from "../registrationAvailability";
import { useRegistrationWindow } from "../useRegistrationWindow";
import RegistrationWindowNotice from "../components/RegistrationWindowNotice";
import WaitlistPanel from "../components/WaitlistPanel";
import EventVenueBookings from "../../venues/components/EventVenueBookings";

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
  const [waitlistEntry, setWaitlistEntry] = useState(null);
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
    <section className="card attendee-event-detail" aria-labelledby="event-title">
      <Link to="/events" className="back-link">Back to events</Link>
      <div className="event-detail-banner" aria-hidden="true"><span>THE NEXT GREAT CONNECTION</span><div /><strong>Starts with<br />showing up.</strong></div>
      <div className="event-detail-layout">
        <div className="event-detail-main">
          <p className="eyebrow">YOUR NEXT EXPERIENCE</p>
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
          </div>

          {event.description && <p className="event-description">{event.description}</p>}
          <section className="event-venues-section" aria-labelledby="event-venues-title">
            <h2 id="event-venues-title">Venues</h2>
            <EventVenueBookings bookings={event.venue_booking_requests} />
          </section>

          <details className="event-help"><summary>How does registration work?</summary><p>Submit the details requested by the organiser. Your registration status and any waitlist offers appear in My registrations. To withdraw, open your registration details; eligibility and time limits are shown there.</p></details>
        </div>
        <div className="event-register-section">
          <p className="eyebrow">YOUR PLACE AT THE EVENT</p>
          <h2>Make it a plan</h2>
          <div className="event-order-summary"><strong>{event.name}</strong><span><Icon name="calendar" size={16} />{event.start_time ? formatDate(event.start_time) : "Date to be announced"}</span><span className={availability.isFull ? "is-full" : undefined} aria-live="polite"><Icon name="ticket" size={16} />{registrationAvailabilityLabel(event)}</span></div>
          <ol className="registration-progress" aria-label="Registration progress"><li className={registered ? "is-complete" : "is-current"} aria-current={registered ? undefined : "step"}><span>{registered ? "✓" : "1"}</span>Your details</li><li className={registered ? "is-current" : ""} aria-current={registered ? "step" : undefined}><span>2</span>Registration saved</li></ol>
          <RegistrationWindowNotice event={event} state={windowState} />
          {registered ? (
            <p role="status">You are registered. Taking you to your registrations…</p>
          ) : event.status === "APPROVED" ? (
            <>
              <WaitlistPanel
                eventId={event.id}
                fields={event.registration_fields ?? []}
                isFull={availability.isFull}
                onEntryChange={setWaitlistEntry}
              />
              {availability.isFull ? (
                null
              ) : waitlistEntry ? (
                null
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
          <Link to="/events" className="registration-return">Keep exploring events</Link>
        </div>
      </div>
    </section>
  );
}

export default function EventDetailPageRoute() {
  const { eventId } = useParams();
  return <EventDetailPage key={eventId} />;
}
