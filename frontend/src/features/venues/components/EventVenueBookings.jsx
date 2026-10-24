import { Link } from "react-router";
import { useContext, useState } from "react";
import { AuthContext } from "../../auth/useAuth";
import { releaseAffectedVenueBooking } from "../../../lib/api";
import "./EventVenueBookings.css";

const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };
const SLOT_ORDER = ["am", "pm", "night"];

function bookingStatus(booking) {
  const statuses = [...new Set((booking.slots ?? []).map((slot) => slot.status))];
  if (statuses.length === 0) return "Unknown";
  if (statuses.length === 1) {
    return statuses[0].charAt(0).toUpperCase() + statuses[0].slice(1);
  }
  return "Partly confirmed";
}

function period(booking) {
  const slots = (booking.slots ?? []).map((slot) => slot.slot);
  return SLOT_ORDER.filter((slot) => slots.includes(slot))
    .map((slot) => SLOT_LABELS[slot])
    .join(", ") || "No period recorded";
}

function ReleaseAffectedBookingButton({ booking }) {
  const auth = useContext(AuthContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!auth) return null;
  const { token } = auth;

  async function release() {
    setBusy(true);
    setError(null);
    try {
      await releaseAffectedVenueBooking(booking.id, token);
      window.location.reload();
    } catch (reason) {
      setError(reason.message);
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={release} disabled={busy}>
        {busy ? "Releasing…" : "Release this booking"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export default function EventVenueBookings({ bookings = [], eventId, canCheck = false, canManageReplacement = false }) {
  if (bookings.length === 0) {
    return <div className="event-venue-bookings"><p className="event-venues__empty">No venue bookings recorded.</p></div>;
  }

  return (
    <div className="event-venue-bookings">
      <ul className="event-venues" aria-label="Event venues">
        {bookings.map((booking) => (
          <li key={booking.id} className={`event-venues__item${booking.is_affected ? " event-venues__item--affected" : ""}`}>
            <div className="event-venues__heading">
              <strong>{booking.venue?.name || "Venue not recorded"}</strong>
              <span className="event-venues__status">
                {booking.is_affected ? "Affected - needs alternative" : bookingStatus(booking)}
              </span>
            </div>
            {booking.is_affected && (
              <p className="event-venues__affected-message" role="alert">
                Venue arrangement unresolved{booking.affected_reason ? `: ${booking.affected_reason}` : "."}
              </p>
            )}
            {booking.venue?.city && (
              <p className="event-venues__location">
                {booking.venue.city}{booking.venue.country ? `, ${booking.venue.country}` : ""}
              </p>
            )}
            <dl className="event-venues__facts">
              <div>
                <dt>Purpose</dt>
                <dd>{booking.purpose || "Not recorded"}</dd>
              </div>
              <div>
                <dt>Period</dt>
                <dd>{booking.booking_date || "Date not recorded"} · {period(booking)}</dd>
              </div>
            </dl>
            {booking.is_affected && canManageReplacement ? (
              <div className="event-venues__actions">
                <Link className="btn btn-secondary" to={`/venues/booking-requests/${booking.id}/replacement`}>
                  Find replacement venue
                </Link>
                <ReleaseAffectedBookingButton booking={booking} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {/* SCRUM-138: the coordinator's way into the per-venue check. The page that
          knows the session decides whether to offer it, and the server still
          authorises the check itself. */}
      {eventId && canCheck && (
        <Link className="btn btn-secondary" to={`/venues/booking-requests?event=${encodeURIComponent(eventId)}`}>
          Check each venue booking
        </Link>
      )}
    </div>
  );
}
