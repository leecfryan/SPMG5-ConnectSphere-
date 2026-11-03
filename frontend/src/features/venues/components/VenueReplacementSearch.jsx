import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { searchReplacementVenues, submitBookingRequest } from "../../../lib/api";
import "./VenueReplacementSearch.css";

export default function VenueReplacementSearch() {
  const { requestId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [busyVenue, setBusyVenue] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    searchReplacementVenues(requestId, {}, token)
      .then((data) => {
        if (!active) return;
        setResult(data);
      })
      .catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [requestId, token]);

  async function requestReplacement(venue) {
    setBusyVenue(venue.venueId);
    setError(null);
    try {
      const original = result.originalBooking;
      await submitBookingRequest(venue.venueId, {
        event_id: original.eventId,
        booking_date: original.bookingDate,
        slots: original.slots,
        expected_attendees: original.expectedAttendees,
        room_layout: original.roomLayout,
        required_facilities: original.requiredFacilities,
        accessibility_requirements: original.accessibilityRequirements,
        purpose: original.purpose,
        replaces_booking_id: original.bookingId,
      }, token);
      navigate(original.eventId ? `/events/managed/${original.eventId}` : "/venues/booking-requests");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusyVenue(null);
    }
  }

  if (error && !result) return <p role="alert">{error}</p>;
  if (!result) return <p role="status">Loading replacement venues…</p>;

  const { originalBooking, candidateVenues } = result;
  return (
    <section className="v-card venue-replacement" aria-labelledby="replacement-title">
      <Link className="venue-replacement__back" to={originalBooking.eventId ? `/events/managed/${originalBooking.eventId}` : "/venues/booking-requests"}>
        Back to event
      </Link>
      <h1 id="replacement-title">Find a replacement venue</h1>
      <div className="venue-replacement__affected" role="status">
        <p className="venue-replacement__eyebrow">Affected booking</p>
        <h2>{originalBooking.eventName || "Event details unavailable"}</h2>
        <dl className="venue-replacement__details">
          <div><dt>Original venue</dt><dd>{originalBooking.venueName}</dd></div>
          <div><dt>When</dt><dd>{originalBooking.bookingDate} · {originalBooking.slots.join(", ")}</dd></div>
          <div><dt>Attendance</dt><dd>{originalBooking.expectedAttendees} attendees</dd></div>
          <div><dt>Layout</dt><dd>{originalBooking.roomLayout}</dd></div>
        </dl>
        {originalBooking.affectedReason && <p className="venue-replacement__reason">Why it is affected: {originalBooking.affectedReason}</p>}
      </div>
      <div className="venue-replacement__intro">
        <h2>Available venues</h2>
        <p>These venues meet the original booking requirements and are available for the same date and time.</p>
      </div>
      {error && <p className="v-alert v-alert-error" role="alert">{error}</p>}
      <ul className="venue-replacement__candidates" aria-label="Replacement venue candidates">
        {candidateVenues.map((venue) => (
          <li key={venue.venueId} className="venue-replacement__candidate">
            <div>
              <h3>{venue.name}</h3>
              <p>{[venue.city, venue.country].filter(Boolean).join(", ") || "Location not recorded"}</p>
              <p className="venue-replacement__capacity">Capacity: {venue.capacity} attendees</p>
              <p className="venue-replacement__match">Meets the original event requirements.</p>
            </div>
            <button type="button" className="v-btn v-btn-primary" onClick={() => requestReplacement(venue)} disabled={busyVenue !== null}>
              {busyVenue === venue.venueId ? "Requesting…" : "Request this venue"}
            </button>
          </li>
        ))}
      </ul>
      {candidateVenues.length === 0 && (
        <section className="venue-replacement__empty" aria-labelledby="no-suitable-venue-title">
          <h2 id="no-suitable-venue-title">No suitable venue found</h2>
          <p>No available venue meets the original event requirements for this date and time.</p>
          <p>You can release this booking and consider replanning the event.</p>
          <Link className="v-btn v-btn-secondary" to={originalBooking.eventId ? `/events/managed/${originalBooking.eventId}` : "/venues/booking-requests"}>
            Back to affected booking
          </Link>
        </section>
      )}
    </section>
  );
}
