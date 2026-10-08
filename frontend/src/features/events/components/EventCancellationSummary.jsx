import { formatWhen } from "../eventFormat";

// SCRUM-148 AC4: shown alongside EventDecisionSummary, not instead of it, so
// a previously approved/rejected event's history and its cancellation are
// both visible together.
export default function EventCancellationSummary({ event }) {
  if (!event.cancelled_at) return null;
  return <section aria-labelledby="cancellation-summary-heading">
    <h2 id="cancellation-summary-heading">Cancellation</h2>
    <dl>
      <div><dt>Cancelled by</dt><dd>{event.cancelled_by_name || "Not recorded"}</dd></div>
      <div><dt>Cancelled on</dt><dd>{formatWhen(event.cancelled_at)}</dd></div>
      <div><dt>Reason</dt><dd>{event.cancellation_reason}</dd></div>
    </dl>
  </section>;
}
