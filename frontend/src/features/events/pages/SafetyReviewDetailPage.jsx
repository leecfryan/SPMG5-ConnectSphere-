import { Link, useParams } from "react-router";
import { useApiResource } from "../../../hooks/useApiResource";
import { formatDay, formatWhen } from "../eventFormat";
import "../workspace.css";

// SCRUM-140 AC2-AC4: everything the Safety Officer needs to judge the event,
// read-only. Each confirmed venue gets its own section (AC3).
//
// AC2 has no dedicated columns (decided 2026-10-14): crowd movement is the
// organiser's comments, emergency access and restrictions are the venue's
// notes, and equipment placement is each reserved item's technical requirement.
// The labels say where each fact comes from so the officer isn't misled.
//
// Deliberately absent:
//   approving or rejecting the safety arrangement   SCRUM-141
const SLOT_LABELS = Object.freeze({ am: "AM", pm: "PM", night: "Night" });

function shown(value) {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "Not provided";
  return value === null || value === undefined || value === "" ? "Not provided" : value;
}

function Facts({ rows }) {
  return <dl>
    {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{shown(value)}</dd></div>)}
  </dl>;
}

function VenueSection({ venue }) {
  const titleId = `safety-venue-${venue.id}`;
  return <section className="safety-venue" aria-labelledby={titleId}>
    <h3 id={titleId}>{venue.name} · {formatDay(venue.booking_date)}</h3>
    <Facts rows={[
      ["Confirmed slots", venue.slots.map(slot => SLOT_LABELS[slot])],
      ["Expected attendees at this venue", venue.expected_attendees],
      ["Venue capacity", venue.capacity],
      ["Layout", venue.room_layout],
      ["Accessibility requested", venue.accessibility_requirements],
      ["Venue accessibility features", venue.accessibility_features],
      ["Emergency access and restrictions (venue notes)", venue.notes],
    ]} />
  </section>;
}

function Detail({ review }) {
  const { event, venues, equipment } = review;
  return <>
    <h1>{event.name}</h1>
    <p>Read only. This page shows the event as submitted for its safety review.</p>
    <section aria-labelledby="safety-event-title">
      <h2 id="safety-event-title">Event</h2>
      <Facts rows={[
        ["Start", formatWhen(event.start_time)],
        ["End", formatWhen(event.end_time)],
        ["Expected attendance", event.expected_attendance],
        ["Description", event.description],
        ["Accessibility needs", event.accessibility_needs],
        ["Crowd movement (organiser's comments)", event.other_comments],
      ]} />
    </section>
    <section aria-labelledby="safety-venues-title">
      <h2 id="safety-venues-title">Confirmed venues</h2>
      {venues.length === 0 ? <p>No confirmed venue booking.</p> : venues.map(venue => <VenueSection key={venue.id} venue={venue} />)}
    </section>
    <section aria-labelledby="safety-equipment-title">
      <h2 id="safety-equipment-title">Reserved equipment</h2>
      {equipment.length === 0 ? <p>No equipment is reserved for this event.</p> : <ul className="event-workspace-list">
        {equipment.map(item => <li key={item.id}>
          <span>{item.type} × {item.quantity_requested}</span>
          <span>Placement and requirements: {shown(item.technical_requirement)}</span>
        </li>)}
      </ul>}
    </section>
  </>;
}

export default function SafetyReviewDetailPage() {
  const { eventId } = useParams();
  const { data, loading, error, reload } = useApiResource(`/api/internal/safety-reviews/${encodeURIComponent(eventId)}`);
  return <section className="card event-workspace">
    <Link to="/safety-reviews">Back to safety reviews</Link>
    {loading && <p role="status">Loading event…</p>}
    {error && <>
      <p role="alert">{error}</p>
      <button type="button" onClick={reload}>Try again</button>
    </>}
    {data && <Detail review={data} />}
  </section>;
}
