import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useApiResource } from "../../../hooks/useApiResource";
import EventRequestForm from "../components/EventRequestForm";
import StatusBadge from "../components/StatusBadge";

function formatWhen(value) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function Submitted({ event, onAnother }) {
  return (
    <section className="card" aria-labelledby="submitted-title">
      <div className="card-heading">
        <p className="eyebrow">EVENT REQUEST</p>
        <h1 id="submitted-title">Request submitted</h1>
        <p>
          ConnectSphere will assign an Event Coordinator, who will be your main
          point of contact for this event.
        </p>
      </div>
      <dl className="event-summary">
        <div>
          <dt>Event</dt>
          <dd>{event.name}</dd>
        </div>
        <div>
          <dt>Starts</dt>
          <dd>{formatWhen(event.start_time)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={event.status} />
          </dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>{event.id}</dd>
        </div>
      </dl>
      <button className="secondary" type="button" onClick={onAnother}>
        Submit another request
      </button>
    </section>
  );
}

// SCRUM-147 AC3: continue a saved draft. The server answers only for the
// caller's own drafts, so another organiser's id shows "Draft not found".
function DraftRequestForm({ draftId, ...formProps }) {
  const { data, error, loading } = useApiResource(`/api/events/drafts/${encodeURIComponent(draftId)}`);
  if (loading) return <p role="status">Loading your draft…</p>;
  if (error) {
    return <>
      <p className="error" role="alert">{error}</p>
      <Link to="/my-event-requests">Back to your event requests</Link>
    </>;
  }
  return <EventRequestForm draft={data.event} {...formProps} />;
}

export default function EventRequestPage() {
  const [params, setParams] = useSearchParams();
  const draftId = params.get("draft");
  const [submitted, setSubmitted] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  // The first save of a new request gives it an id; putting it in the address
  // means a refresh, or a later visit, continues the same draft.
  function draftSaved(draft) {
    setSavedAt(new Date());
    if (draft.id !== draftId) setParams({ draft: draft.id }, { replace: true });
  }

  if (submitted) {
    return (
      <Submitted event={submitted} onAnother={() => { setSubmitted(null); setSavedAt(null); setParams({}); }} />
    );
  }

  const formProps = { onSubmitted: setSubmitted, onDraftSaved: draftSaved };
  return (
    <section className="card" aria-labelledby="event-request-title">
      <div className="card-heading">
        <p className="eyebrow">{draftId ? "DRAFT EVENT REQUEST" : "NEW EVENT REQUEST"}</p>
        <h1 id="event-request-title">Tell us about your event</h1>
        <p>
          Fill in the required details and submit. Requirements are optional;
          add whatever you already know. Save a draft to finish it later.
        </p>
      </div>
      {savedAt && (
        <p role="status">
          Draft saved at {savedAt.toLocaleTimeString(undefined, { timeStyle: "short" })}. Only you can see it.
        </p>
      )}
      {draftId
        ? <DraftRequestForm key={draftId} draftId={draftId} {...formProps} />
        : <EventRequestForm {...formProps} />}
    </section>
  );
}
