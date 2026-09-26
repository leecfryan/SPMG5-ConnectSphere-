import { Link, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { useApiResource } from "../../../hooks/useApiResource";
import { workspaces } from "../workspaces";
import EventReviewControls from "../components/EventReviewControls";
import "../workspace.css";

function Detail({ scope, eventId }) {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApiResource(`/api/event-workspace/${scope}/${eventId}`);
  const event = data?.event;
  const fields = [
    ["Status", "status"], ["Purpose", "purpose"], ["Description", "description"],
    ["Start", "start_time"], ["End", "end_time"], ["Expected attendance", "expected_attendance"],
    ["Venue requirements", "venue_requirements"], ["Accessibility needs", "accessibility_needs"],
    ["Equipment needs", "equipment_needs"], ["Other comments", "other_comments"],
  ];
  return <section className="card event-workspace">
    <Link to={workspaces[scope].path}>Back to {workspaces[scope].title.toLowerCase()}</Link>
    {loading && <p role="status">Loading event…</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={reload}>Refresh event</button>
    {event && <>
      <h1>{event.name}</h1>
      <p>Coordinator: {event.coordinator_id || "Not assigned yet"}</p>
      <dl>{fields.map(([label, field]) => <div key={field}><dt>{label}</dt><dd>{event[field] ?? "Not provided"}</dd></div>)}</dl>
      {scope === "manager" && <EventReviewControls key={`${event.id}:${event.status}:${event.coordinator_id}`} event={event} onUpdated={reload} />}
      {scope === "coordinator" && event.coordinator_id === user.id && ["ACCEPTED", "APPROVED"].includes(event.status) && <nav className="event-actions" aria-label="Event arrangements">
        <Link to="/venues">Arrange venue bookings</Link>
        <Link to={`/equipment/requests?event=${encodeURIComponent(event.id)}`}>Arrange equipment and technical support</Link>
      </nav>}
    </>}
  </section>;
}

export default function EventWorkspaceDetailPage({ scope }) {
  const { eventId } = useParams();
  return <Detail key={`${scope}:${eventId}`} scope={scope} eventId={eventId} />;
}
