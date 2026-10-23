import { formatWhen } from "../eventFormat";

const LABELS = {
  name: "Event name", purpose: "Purpose", description: "Description",
  start_time: "Start", end_time: "End", registration_start: "Registration start",
  registration_end: "Registration end", expected_attendance: "Expected attendance",
  venue_requirements: "Venue requirements", accessibility_needs: "Accessibility needs",
  equipment_needs: "Equipment needs", other_comments: "Other comments",
};
const TIMES = ["start_time", "end_time", "registration_start", "registration_end"];
function display(field, value) {
  if (value == null || value === "") return "Not provided";
  return TIMES.includes(field) ? formatWhen(value) : String(value);
}

export default function EventResubmissionChanges({ activity }) {
  const latest = activity?.find(entry => entry.action === "REQUEST_RESUBMITTED");
  if (!latest) return null;
  return <section className="event-resubmission" aria-labelledby="resubmission-heading">
    <p className="eyebrow">Organiser update · {formatWhen(latest.created_at)}</p>
    <h2 id="resubmission-heading">Changes on resubmission</h2>
    <p>Compared with the details when this request was returned for changes.</p>
    {!latest.changes?.length ? <p>No request fields changed.</p> : <ul className="event-change-list">
      {latest.changes.map(change => <li key={change.field}>
        <h3>{LABELS[change.field] || change.field}</h3>
        <dl><div><dt>Before</dt><dd>{display(change.field, change.before)}</dd></div>
          <div><dt>After</dt><dd>{display(change.field, change.after)}</dd></div></dl>
      </li>)}
    </ul>}
  </section>;
}
