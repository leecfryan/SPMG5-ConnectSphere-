import { Link } from "react-router";
import { useApiResource } from "../../../hooks/useApiResource";
import Icon from "../../../components/ui/Icon";
import { formatDay } from "../eventFormat";
import { displayReason, needsAttention } from "../venueAttention";

// SCRUM-38: venue bookings flagged as no longer fitting the event, kept on the
// coordinator's event page until each is replaced or released (SCRUM-145).
// Reads the existing coordinator-scoped booking-requests list.
export default function VenueAttentionPanel({ eventId }) {
  const { data, error } = useApiResource(`/api/venues/booking-requests?event_id=${eventId}`);
  if (error) return <p className="error" role="alert">This event's venue bookings could not be loaded. Refresh the event to try again.</p>;
  const flagged = (data?.data ?? []).filter(needsAttention);
  if (flagged.length === 0) return null;
  return <section className="venue-attention" aria-labelledby="venue-attention-heading">
    <div className="venue-attention__header">
      <span className="venue-attention__icon"><Icon name="bell" size={20} /></span>
      <div>
        <p className="eyebrow">Venue needs attention</p>
        <h2 id="venue-attention-heading">
          {flagged.length === 1 ? "A venue booking no longer fits this event" : `${flagged.length} venue bookings no longer fit this event`}
        </h2>
        <p className="venue-attention__help">Find a replacement, or release the booking from My Events. The event cannot go to
          safety review until each one is resolved.</p>
      </div>
    </div>
    <ul className="venue-attention__list">
      {flagged.map(request => <li className="venue-attention__item" key={request.id}>
        <div className="venue-attention__where">
          <span><Icon name="pin" size={16} /><strong>{request.venue?.name ?? "Venue"}</strong></span>
          <span><Icon name="calendar" size={16} />{formatDay(request.booking_date)}</span>
        </div>
        <p className="venue-attention__reason">{displayReason(request.affected_reason)}</p>
        <div className="venue-attention__actions">
          <Link className="venue-attention__primary" to={`/venues/booking-requests/${request.id}/replacement`}>
            Find replacement venue<Icon name="arrow" size={16} />
          </Link>
          <Link className="venue-attention__secondary" to={`/events/managed/${eventId}`}>Release on My Events</Link>
        </div>
      </li>)}
    </ul>
  </section>;
}
