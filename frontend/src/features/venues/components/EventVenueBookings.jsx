import { Link } from "react-router";

const SLOT_LABELS = { am: "AM", pm: "PM", night: "Night" };
const SLOT_ORDER = ["am", "pm", "night"];

function bookingStatus(booking) {
  const statuses = [...new Set((booking.slots ?? []).map((slot) => slot.status))];
  if (statuses.length === 0) return "Unknown";
  if (statuses.length === 1) {
    return statuses[0].charAt(0).toUpperCase() + statuses[0].slice(1);
  }
  return "Partly decided";
}

function period(booking) {
  const slots = (booking.slots ?? []).map((slot) => slot.slot);
  return SLOT_ORDER.filter((slot) => slots.includes(slot))
    .map((slot) => SLOT_LABELS[slot])
    .join(", ") || "No period recorded";
}

export default function EventVenueBookings({ bookings = [], eventId, canCheck = false }) {
  if (bookings.length === 0) {
    return <p className="event-venues__empty">No venue bookings recorded.</p>;
  }

  return (
    <>
      <ul className="event-venues" aria-label="Event venues">
        {bookings.map((booking) => (
          <li key={booking.id} className="event-venues__item">
            <div className="event-venues__heading">
              <strong>{booking.venue?.name || "Venue not recorded"}</strong>
              <span className="event-venues__status">{bookingStatus(booking)}</span>
            </div>
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
    </>
  );
}
