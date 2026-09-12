import { useState } from "react";
import EventRequestForm from "../components/EventRequestForm";

function formatWhen(value) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function Saved({ event, onAnother }) {
  return (
    <section className="card" aria-labelledby="saved-title">
      <div className="card-heading">
        <p className="eyebrow">EVENT REQUEST</p>
        <h1 id="saved-title">Draft saved</h1>
        <p>Your request is stored. Nothing has been sent for review yet.</p>
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
          <dd>{event.status}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>{event.id}</dd>
        </div>
      </dl>
      <button className="secondary" type="button" onClick={onAnother}>
        Create another request
      </button>
    </section>
  );
}

export default function EventRequestPage() {
  const [saved, setSaved] = useState(null);

  if (saved) return <Saved event={saved} onAnother={() => setSaved(null)} />;

  return (
    <section className="card" aria-labelledby="event-request-title">
      <div className="card-heading">
        <p className="eyebrow">NEW EVENT REQUEST</p>
        <h1 id="event-request-title">Tell us about your event</h1>
        <p>
          Only the name is needed to save a draft. Fill in the rest as the plan
          takes shape.
        </p>
      </div>
      <EventRequestForm onCreated={setSaved} />
    </section>
  );
}
