import { formatWhen } from "../eventFormat";

// SCRUM-141 AC4: the event's recorded decisions, newest first, for whoever may
// see the event. null (or absent) means the server could not read the history.
const ACTIONS = Object.freeze({
  SAFETY_APPROVED: "Safety arrangement approved",
  SAFETY_REJECTED: "Safety arrangement rejected",
});

export default function EventActivityHistory({ activity }) {
  return <section aria-labelledby="activity-history-heading">
    <h2 id="activity-history-heading">Activity history</h2>
    {activity == null && <p>Activity history is unavailable right now. Refresh the event to try again.</p>}
    {activity?.length === 0 && <p>No activity recorded yet.</p>}
    {activity?.length > 0 && <ol className="event-workspace-list">
      {activity.map(entry => <li key={entry.id}>
        <span>{ACTIONS[entry.action] ?? entry.action} · {formatWhen(entry.created_at)}</span>
        {entry.note && <span>{entry.action === "SAFETY_REJECTED" ? "Reason" : "Note"}: {entry.note}</span>}
      </li>)}
    </ol>}
  </section>;
}
