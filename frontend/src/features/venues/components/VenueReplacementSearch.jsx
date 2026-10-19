import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { searchReplacementVenues, submitBookingRequest } from "../../../lib/api";

export default function VenueReplacementSearch() {
  const { requestId } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [filters, setFilters] = useState(null);
  const [busyVenue, setBusyVenue] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    searchReplacementVenues(requestId, {}, token)
      .then((data) => {
        if (!active) return;
        setResult(data);
        setFilters({
          minCapacity: data.originalBooking.expectedAttendees,
          roomLayout: data.originalBooking.roomLayout,
          facilities: data.originalBooking.requiredFacilities,
          accessibility: data.originalBooking.accessibilityRequirements,
        });
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
  if (!result || !filters) return <p role="status">Loading replacement venues…</p>;

  const { originalBooking, candidateVenues } = result;
  return (
    <section className="v-card venue-replacement" aria-labelledby="replacement-title">
      <Link to="/venues/booking-requests">Back to venue requests</Link>
      <h1 id="replacement-title">Find a replacement venue</h1>
      <div className="v-alert" role="status">
        <strong>Affected booking preserved</strong>
        <p>{originalBooking.venueName} · {originalBooking.bookingDate} · {originalBooking.slots.join(", ")}</p>
        <p>{originalBooking.expectedAttendees} attendees · {originalBooking.roomLayout}</p>
        {originalBooking.affectedReason && <p>Reason: {originalBooking.affectedReason}</p>}
      </div>
      <p>Search uses the original event requirements. You can relax the filters and submit a replacement through the normal approval flow.</p>
      <label className="v-field">
        <span className="v-label">Minimum capacity</span>
        <input
          className="v-input"
          type="number"
          min="1"
          value={filters.minCapacity}
          onChange={(event) => setFilters({ ...filters, minCapacity: event.target.value })}
        />
      </label>
      {error && <p className="v-alert v-alert-error" role="alert">{error}</p>}
      <ul aria-label="Replacement venue candidates">
        {candidateVenues.map((venue) => (
          <li key={venue.venueId}>
            <strong>{venue.name}</strong> ({venue.city}) — capacity {venue.capacity}
            <button type="button" className="v-btn v-btn-primary" onClick={() => requestReplacement(venue)} disabled={busyVenue !== null}>
              {busyVenue === venue.venueId ? "Requesting…" : "Request as replacement"}
            </button>
          </li>
        ))}
      </ul>
      {candidateVenues.length === 0 && <p>No replacement venues match these requirements.</p>}
    </section>
  );
}
