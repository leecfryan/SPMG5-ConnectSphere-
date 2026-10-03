import StatusBadge from "./StatusBadge";
import { formatDay, shortReference } from "../eventFormat";

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
            <span className="assign-queue-meta">
              {formatDay(event.start_time)} · Ref {shortReference(event.id)}
            </span>
            <StatusBadge status={event.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}
