import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../../lib/auth";
import { apiFetch } from "../../../lib/api";
import RegistrationForm from "../components/RegistrationForm";
import { useEventRegistration } from "../hooks/useEventRegistration";

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function EventDetailPage() {
  const { eventId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [eventError, setEventError] = useState("");
  const [registered, setRegistered] = useState(false);
  const { register, busy, error: regError } = useEventRegistration();

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`/api/events/${eventId}`, token, { signal: controller.signal })
      .then((data) => setEvent(data.event))
      .catch((err) => { if (err.name !== "AbortError") setEventError(err.message); });
    return () => controller.abort();
  }, [eventId, token]);

  async function handleSubmit(registrationData) {
    const result = await register(eventId, registrationData);
    if (result) {
      setRegistered(true);
      setTimeout(() => navigate("/registrations/me"), 1500);
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
        {event.expected_attendance && (
          <span className="event-meta__item">
            <span className="event-meta__label">Expected attendance</span>
            {event.expected_attendance}
          </span>
        )}
      </div>

      {event.description && <p className="event-description">{event.description}</p>}
      {event.other_comments && <p className="card-note">{event.other_comments}</p>}

      <div className="event-register-section">
        {registered ? (
          <p role="status">You are registered. Taking you to your registrations…</p>
        ) : event.status === "APPROVED" ? (
          <>
            <h2>Register for this event</h2>
            <p>Fill in your details below to secure your spot.</p>
            {regError && <p className="error" role="alert">{regError}</p>}
            <RegistrationForm fields={event.registration_fields ?? []} onSubmit={handleSubmit} busy={busy} disabled={false} />
          </>
        ) : (
          <p>Registration is not currently open for this event.</p>
        )}
      </div>
    </section>
  );
}
