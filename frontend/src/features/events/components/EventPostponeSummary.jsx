import { formatWhen } from "../eventFormat";

// SCRUM-149: shown alongside EventDecisionSummary/EventCancellationSummary,
// not instead of them, so prior history and the postponement are both
// visible together - same shape as EventCancellationSummary.
export default function EventPostponeSummary({ event }) {
  if (!event.postponed_at) return null;
  return <section aria-labelledby="postpone-summary-heading">
    <h2 id="postpone-summary-heading">Postponement</h2>
    <dl>
      <div><dt>Postponed by</dt><dd>{event.postponed_by_name || "Not recorded"}</dd></div>
      <div><dt>Postponed on</dt><dd>{formatWhen(event.postponed_at)}</dd></div>
      <div><dt>Reason</dt><dd>{event.postponement_reason}</dd></div>
    </dl>
  </section>;
}
