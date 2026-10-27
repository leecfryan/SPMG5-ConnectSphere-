import StatusBadge from "./StatusBadge";
import { formatRange, shortReference } from "../eventFormat";

// Decorative, like the venue pages' inline icons: the text beside it carries the meaning.
function PersonIcon() {
  return (
    <svg className="assign-queue-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
    </svg>
  );
}

// SCRUM-159 AC2: each row shows the event name, organiser, proposed dates and
// expected attendance, so the Lead can scan the queue without opening a request.
export default function EventQueueList({ events, selectedId, onSelect }) {
  if (events.length === 0) {
    return (
      <p className="assign-empty" role="status">
        No submitted requests are waiting for a coordinator.
      </p>
    );
  }

  return (
    <ul className="assign-queue">
      {events.map((event) => (
        <li key={event.id}>
          <button
            type="button"
            className={`assign-queue-item${event.id === selectedId ? " is-selected" : ""}`}
            aria-current={event.id === selectedId ? "true" : undefined}
            onClick={() => onSelect(event.id)}
          >
            <span className="assign-queue-name">{event.name}</span>
            <span className="assign-queue-organiser">{event.organiser_name || "Organiser unavailable"}</span>
            <span className="assign-queue-meta">{formatRange(event.start_time, event.end_time)}</span>
            <span className="assign-queue-meta">
              <span className="assign-queue-attendance">
                <PersonIcon />
                {event.expected_attendance ? `${event.expected_attendance} expected` : "Attendance not set"}
              </span>
              {" · "}Ref {shortReference(event.id)}
            </span>
            <StatusBadge status={event.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}
