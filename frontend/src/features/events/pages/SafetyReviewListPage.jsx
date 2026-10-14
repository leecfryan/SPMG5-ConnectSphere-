import { Link } from "react-router";
import { useApiResource } from "../../../hooks/useApiResource";
import { formatWhen } from "../eventFormat";
import "../workspace.css";

// SCRUM-140 AC1: the Safety Officer's queue of events awaiting safety review.
//
// Deliberately absent:
//   approving or rejecting the safety arrangement   SCRUM-141
//   confirming the event                            SCRUM-144
export default function SafetyReviewListPage() {
  const { data, loading, error, reload } = useApiResource("/api/internal/safety-reviews");
  return <section className="card event-workspace" aria-labelledby="safety-reviews-title">
    <h1 id="safety-reviews-title">Safety reviews</h1>
    <p>Events waiting for an operational safety review, soonest first.</p>
    <button type="button" onClick={reload}>Refresh events</button>
    {loading && <p role="status">Loading events…</p>}
    {error && <p role="alert">{error}</p>}
    {data?.events.length === 0 && <p>No events are waiting for a safety review.</p>}
    {data?.events.length > 0 && <ul className="event-workspace-list">
      {data.events.map(event => <li key={event.id}>
        <Link to={`/safety-reviews/${event.id}`}>{event.name}</Link>
        <span>{formatWhen(event.start_time)} · {event.expected_attendance} expected</span>
      </li>)}
    </ul>}
  </section>;
}
