import { formatWhen } from "../eventFormat";

// SCRUM-99 AC3: the decision, who made it and when. Shown wherever the event is
// shown; the server decides who may load the event at all (discussion #125).
// The approver's name can be missing when that account no longer exists.
export default function EventDecisionSummary({ event }) {
  if (!event.approved_rejected_at) return null;
  const rejected = event.status === "REJECTED";
  return <section aria-labelledby="decision-summary-heading">
    <h2 id="decision-summary-heading">Review decision</h2>
    <dl>
      <div><dt>Outcome</dt><dd>{rejected ? "Rejected" : "Approved – planning"}</dd></div>
      <div><dt>Decided by</dt><dd>{event.approved_rejected_by_name || "Not recorded"}</dd></div>
      <div><dt>Decided on</dt><dd>{formatWhen(event.approved_rejected_at)}</dd></div>
      {event.approval_rejection_remark && <div><dt>{rejected ? "Reason" : "Note"}</dt><dd>{event.approval_rejection_remark}</dd></div>}
    </dl>
  </section>;
}
