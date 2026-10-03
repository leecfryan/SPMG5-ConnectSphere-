import StatusBadge from "./StatusBadge";
import { formatWhen, shortReference } from "../eventFormat";

const SECTIONS = [
  ["Purpose", "purpose"],
  ["Description", "description"],
  ["Venue requirements", "venue_requirements"],
  ["Accessibility needs", "accessibility_needs"],
  ["Equipment needs", "equipment_needs"],
  ["Other comments", "other_comments"],
];

export default function EventDetailPanel({ event }) {
  return (
    <div className="assign-detail">
      <div className="assign-detail-head">
        <h2>{event.name}</h2>
        <StatusBadge status={event.status} />
      </div>
      <dl className="event-summary">
        <div>
          <dt>Reference</dt>
          <dd>{shortReference(event.id)}</dd>
        </div>
        <div>
          <dt>Starts</dt>
          <dd>{formatWhen(event.start_time)}</dd>
        </div>
        <div>
          <dt>Ends</dt>
          <dd>{formatWhen(event.end_time)}</dd>
        </div>
        <div>
          <dt>Expected attendance</dt>
          <dd>{event.expected_attendance ?? "Not set"}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatWhen(event.submitted_at)}</dd>
        </div>
        {SECTIONS.map(([label, field]) => (
          <div key={field}>
            <dt>{label}</dt>
            {/* Optional free text: "where relevant" in the customer's words,
                so an empty one is normal rather than missing data. */}
            <dd>{event[field] || "Not provided"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
