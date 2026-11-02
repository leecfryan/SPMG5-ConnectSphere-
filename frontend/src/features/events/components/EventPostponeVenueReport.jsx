import { formatDay } from "../eventFormat";

const SLOT_LABELS = Object.freeze({ am: "AM", pm: "PM", night: "Night" });

// SCRUM-170: after postponing with a new date, each venue booking's result on
// that date: moved (pending Venue Staff's decision) or released, and why.
// Shown once, straight after postponing; null means no new date was given.
export default function EventPostponeVenueReport({ report }) {
  if (!report) return null;
  return <section className="event-postponed" aria-labelledby="postpone-venues-heading" aria-live="polite">
    <p className="eyebrow">New date</p>
    <h2 id="postpone-venues-heading">Venues for the new date</h2>
    {report.length === 0 && <p>The event had no venue bookings to move.</p>}
    {report.length > 0 && <ul className="event-workspace-list">
      {report.map((result) => <li key={result.booking_id}>
        <strong>{result.venue_name}</strong>{" "}
        ({formatDay(result.new_booking_date)}, {result.slots.map((slot) => SLOT_LABELS[slot]).join(", ")}):{" "}
        {result.passed
          ? "moved to the new date and waiting for Venue Staff to approve it again."
          : <>released. {result.reasons.join(" ")}</>}
      </li>)}
    </ul>}
  </section>;
}
