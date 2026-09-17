import { useState } from "react";
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

export default function EventRequestPage() {
  const [submitted, setSubmitted] = useState(null);

  if (submitted) {
    return (
      <Submitted event={submitted} onAnother={() => setSubmitted(null)} />
    );
  }

  return (
    <section className="card" aria-labelledby="event-request-title">
      <div className="card-heading">
        <p className="eyebrow">NEW EVENT REQUEST</p>
        <h1 id="event-request-title">Tell us about your event</h1>
        <p>
          Fill in the required details and submit. Requirements are optional;
          add whatever you already know.
        </p>
      </div>
      <EventRequestForm onSubmitted={setSubmitted} />
    </section>
  );
}
