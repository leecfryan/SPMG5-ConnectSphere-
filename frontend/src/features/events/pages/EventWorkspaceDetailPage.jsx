import { useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { useApiResource } from "../../../hooks/useApiResource";
import Icon from "../../../components/ui/Icon";
import { formatWhen, shortReference } from "../eventFormat";
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
import ChangeRequestControls from "../components/ChangeRequestControls";
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
  const sections = [
    { id: "about", title: "About the event", icon: "request", fields: [["Purpose", "purpose"], ["Description", "description"]] },
    { id: "registration", title: "Registration window", icon: "calendar", fields: [["Registration start", "registration_start"], ["Registration end", "registration_end"]] },
    { id: "requirements", title: "Planning requirements", icon: "grid", fields: [["Venue requirements", "venue_requirements"], ["Accessibility needs", "accessibility_needs"], ["Equipment needs", "equipment_needs"], ["Other comments", "other_comments"]] },
  ];
  return <section className="card event-workspace event-request-detail">
    <div className="request-detail-navigation">
      <Link className="back-link" to={workspaces[scope].path}>Back to {workspaces[scope].title.toLowerCase()}</Link>
      <button className="secondary request-detail-refresh" type="button" onClick={reload}>Refresh event</button>
    </div>
    {loading && <p className="request-detail-loading" role="status">Loading event…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {event && <>
      <header className="request-detail-header">
        <p className="eyebrow">EVENT REQUEST</p>
        <div className="request-detail-title-row">
          <h1>{event.name}</h1>
          <dl className="request-detail-status"><div><dt>Status</dt><dd><StatusBadge status={event.status} /></dd></div></dl>
        </div>
        <div className="request-detail-reference"><span><Icon name="request" size={15} />Request <code title={event.id}>{shortReference(event.id)}</code></span><span>Times shown in your local timezone.</span></div>
      </header>
      <dl className="request-detail-facts">
        <div><dt><Icon name="calendar" size={17} />Start</dt><dd>{formatWhen(event.start_time)}</dd></div>
        <div><dt><Icon name="clock" size={17} />End</dt><dd>{formatWhen(event.end_time)}</dd></div>
        <div><dt><Icon name="account" size={17} />Expected attendance</dt><dd>{event.expected_attendance ?? "Not provided"}</dd></div>
      </dl>
      {scope === "coordinator" && event.coordinator_id === user.id && <EventSavedChanges comparison={event.request_changes} />}
      {saved && <p className="request-detail-success" role="status"><Icon name="check" size={18} />Event changes saved.</p>}
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
          // SCRUM-164 AC2: locked past SUBMITTED, except CHANGES_REQUESTED
          // (SCRUM-117: coordinator returned it for clarification, organiser must edit then resubmit).
          ["SUBMITTED", "CHANGES_REQUESTED"].includes(event.status) ?
            (editing ? <EventRequestForm key={event.id} event={event} onCancel={() => setEditing(false)} onSubmitted={() => {
              setEditing(false); setSaved(true); reload();
            }} /> : <button className="secondary request-detail-edit" type="button" onClick={() => { setSaved(false); setEditing(true); }}>Edit event</button>) :
            <p className="request-detail-notice"><Icon name="shield" size={19} /><span>Editing is no longer available. The event has moved to review and changes are locked.</span></p>
        ) : <p className="request-detail-notice"><Icon name="shield" size={19} /><span>View only. Only the responsible organiser can edit this event.</span></p>}
        {/* SCRUM-36: change request for UNDER_REVIEW / APPROVED events */}
        {event.organiser_id === user.id && hasPermission("events.own.update") &&
          <ChangeRequestControls event={event} onSubmitted={reload} />}
      </>}
      {scope === "organiser" && event.organiser_id === user.id && hasPermission("events.own.update") &&
        event.status === "CHANGES_REQUESTED" && !editing && !loading && <EventResubmitControl
          key={clarification?.id} eventId={event.id} cycleId={clarification?.id}
          onResubmitted={() => { setSaved(false); reload(); }} />}
      {scope === "coordinator" && event.coordinator_id === user.id && <EventDecisionControls event={event} onDecided={reload} />}
      <div className="request-detail-grid">
        {sections.map(section => <section className={`request-detail-panel request-detail-panel--${section.id}`} key={section.id} aria-labelledby={`request-${section.id}-heading`}>
          <h2 id={`request-${section.id}-heading`}><Icon name={section.icon} size={19} />{section.title}</h2>
          <dl className="request-detail-fields">
            {section.fields.map(([label, field]) => <div key={field}><dt>{label}</dt><dd>{field === "registration_start" || field === "registration_end" ? (event[field] ? formatWhen(event[field]) : "Not provided") : (event[field] || "Not provided")}</dd></div>)}
          </dl>
        </section>)}
        <section className="request-detail-panel request-detail-panel--coordinator" aria-labelledby="request-coordinator-heading">
          <h2 id="request-coordinator-heading"><Icon name="account" size={19} />Coordinator</h2>
          <p className="request-coordinator-state"><span className={`status-badge${event.coordinator_id ? "" : " status-draft"}`}>{event.coordinator_id ? "Coordinator assigned" : "Not assigned yet"}</span></p>
          <p className="request-detail-hint">{event.coordinator_id ? "A coordinator is assigned to review and plan this event." : "Coordinator assignment will appear here when it is available."}</p>
          {event.coordinator_id && <details className="request-coordinator-reference"><summary>View coordinator reference</summary><code>{event.coordinator_id}</code></details>}
        </section>
      </div>
      <div className="request-detail-records">
        <EventDecisionSummary event={event} />
        <EventCancellationSummary event={event} />
        <EventPostponeSummary event={event} />
        <EventActivityHistory activity={event.activity} />
        {scope === "coordinator" && event.coordinator_id === user.id && <EventResubmissionChanges activity={event.activity} />}
      </div>
      <div className="request-detail-management">
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
      </div>
    </>}
  </section>;
}

export default function EventWorkspaceDetailPage({ scope }) {
  const { eventId } = useParams();
  return <Detail key={`${scope}:${eventId}`} scope={scope} eventId={eventId} />;
}
