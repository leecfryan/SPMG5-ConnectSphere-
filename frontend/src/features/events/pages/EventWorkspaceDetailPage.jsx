import { useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { useApiResource } from "../../../hooks/useApiResource";
import { workspaces } from "../workspaces";
import EventReviewControls from "../components/EventReviewControls";
import EventDecisionControls from "../components/EventDecisionControls";
import EventDecisionSummary from "../components/EventDecisionSummary";
import EventActivityHistory from "../components/EventActivityHistory";
import EventCancelControl from "../components/EventCancelControl";
import EventCancellationSummary from "../components/EventCancellationSummary";
import EventPostponeControl from "../components/EventPostponeControl";
import EventPostponeSummary from "../components/EventPostponeSummary";
import EventRequestForm from "../components/EventRequestForm";
import SafetyCheckControls from "../components/SafetyCheckControls";
import ConfirmEventControls from "../components/ConfirmEventControls";
import EventSavedChanges from "../components/EventSavedChanges";
import EventResubmitControl from "../components/EventResubmitControl";
import EventResubmissionChanges from "../components/EventResubmissionChanges";
import StatusBadge from "../components/StatusBadge";
import "../workspace.css";

function Detail({ scope, eventId }) {
  const { user, hasPermission } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const { data, loading, error, reload } = useApiResource(`/api/event-workspace/${scope}/${eventId}`);
  const event = data?.event;
  const clarification = event?.activity?.find(entry => entry.action === "CHANGES_REQUESTED");
  const fields = [
    ["Purpose", "purpose"], ["Description", "description"],
    ["Registration start", "registration_start"], ["Registration end", "registration_end"],
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
      <dl><div><dt>Status</dt><dd><StatusBadge status={event.status} /></dd></div></dl>
      {scope === "coordinator" && event.coordinator_id === user.id && <EventSavedChanges comparison={event.request_changes} />}
      {saved && <p role="status">Event changes saved.</p>}
      {event.status === "CHANGES_REQUESTED" && <section className="event-clarification" aria-labelledby="clarification-heading">
        <p className="eyebrow">Coordinator feedback</p>
        <h2 id="clarification-heading">Clarification requested</h2>
        {clarification?.note
          ? <blockquote className="event-clarification-message">{clarification.note}</blockquote>
          : <p>The clarification message is unavailable. Refresh the event to try again.</p>}
        <p className="event-clarification-next">
          {scope === "organiser" && event.organiser_id === user.id && hasPermission("events.own.update")
            ? "Edit and save the request details, then resubmit for review. Your coordinator stays assigned."
            : "Awaiting updates from the organiser. The coordinator stays assigned to this request."}
        </p>
      </section>}
      {scope === "organiser" && <>
        {event.organiser_id === user.id && hasPermission("events.own.update") ? (
          // SCRUM-164 AC2: editing is only allowed while the event is still SUBMITTED.
          event.status === "SUBMITTED" ?
            (editing ? <EventRequestForm key={event.id} event={event} onCancel={() => setEditing(false)} onSubmitted={() => {
              setEditing(false); setSaved(true); reload();
            }} /> : <button type="button" onClick={() => { setSaved(false); setEditing(true); }}>Edit event</button>) :
            <p>Editing is no longer available. The event has moved to review and changes are locked.</p>
        ) : <p>View only. Only the responsible organiser can edit this event.</p>}
      </>}
      {scope === "organiser" && event.organiser_id === user.id && hasPermission("events.own.update") &&
        event.status === "CHANGES_REQUESTED" && !editing && !loading && <EventResubmitControl
          key={clarification?.id} eventId={event.id} cycleId={clarification?.id}
          onResubmitted={() => { setSaved(false); reload(); }} />}
      {scope === "coordinator" && event.coordinator_id === user.id && <EventDecisionControls event={event} onDecided={reload} />}
      <p>Coordinator: {event.coordinator_id || "Not assigned yet"}</p>
      <dl>
        {fields.map(([label, field]) => <div key={field}><dt>{label}</dt><dd>{event[field] ?? "Not provided"}</dd></div>)}
      </dl>
      <EventDecisionSummary event={event} />
      <EventCancellationSummary event={event} />
      <EventPostponeSummary event={event} />
      <EventActivityHistory activity={event.activity} />
      {scope === "coordinator" && event.coordinator_id === user.id && <EventResubmissionChanges activity={event.activity} />}
      {scope === "coordinator" && event.coordinator_id === user.id && <SafetyCheckControls key={event.status} event={event} onChanged={reload} />}
      {scope === "coordinator" && event.coordinator_id === user.id && event.status === "PREPARATION" && <ConfirmEventControls event={event} onChanged={reload} />}
      {scope === "manager" && <EventReviewControls key={`${event.id}:${event.status}:${event.coordinator_id}`} event={event} onUpdated={reload} />}
      {scope === "coordinator" && event.coordinator_id === user.id && ["APPROVED", "CONFIRMED"].includes(event.status) && <nav className="event-actions" aria-label="Event arrangements">
        <Link to="/venues">Arrange venue bookings</Link>
        <Link to={`/equipment/requests?event=${encodeURIComponent(event.id)}`}>Arrange equipment and technical support</Link>
      </nav>}
      {(scope === "manager" || (scope === "coordinator" && event.coordinator_id === user.id)) && <>
        <EventPostponeControl event={event} onPostponed={reload} />
        <EventCancelControl event={event} onCancelled={reload} />
      </>}
    </>}
  </section>;
}

export default function EventWorkspaceDetailPage({ scope }) {
  const { eventId } = useParams();
  return <Detail key={`${scope}:${eventId}`} scope={scope} eventId={eventId} />;
}
