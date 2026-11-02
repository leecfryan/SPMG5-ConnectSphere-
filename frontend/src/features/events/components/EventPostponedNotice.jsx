import { formatWhen, postponedToStart } from "../eventFormat";

// SCRUM-170: a postponed event says so at the top of its page for every role,
// before its dates. Who postponed it and when stay in EventPostponeSummary with
// the other records.
export default function EventPostponedNotice({ event }) {
  if (event.status !== "POSTPONED") return null;
  const newStart = postponedToStart(event);
  return <section className="event-postponed" aria-labelledby="postponed-notice-heading">
    <p className="eyebrow">Postponed</p>
    <h2 id="postponed-notice-heading">This event is postponed</h2>
    {newStart
      ? <p>New date: {formatWhen(newStart)}. Venue bookings that still fitted were moved to the new date for Venue Staff to approve again; the others and any holds were released.</p>
      : <p>No new date has been set yet. Its venue bookings and holds were released, so those venues are free for other events.</p>}
    {event.postponement_reason && <blockquote className="event-postponed-reason">{event.postponement_reason}</blockquote>}
  </section>;
}
