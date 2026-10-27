import { useState } from "react";
import { formatWhen } from "../eventFormat";

// SCRUM-141 AC4: the event's recorded decisions, newest first, for whoever may
// see the event. null (or absent) means the server could not read the history.
const ACTIONS = Object.freeze({
  REQUEST_RESUBMITTED: "Request resubmitted",
  CHANGES_REQUESTED: "Changes requested",
  SAFETY_APPROVED: "Safety arrangement approved",
  SAFETY_REJECTED: "Safety arrangement rejected",
  // SCRUM-37: apply_organiser_event_edit (SQL) names the fields that actually
  // changed in its own note, so this label stays generic rather than
  // repeating "significant change" twice. event.ordinary_edit is every other
  // organiser edit - logged too (towards SCRUM-164 AC3), just without the
  // re-approval consequence.
  "event.significant_edit": "Significant change",
  "event.ordinary_edit": "Normal change",
});

// A long-lived event accumulates one entry per edit (SCRUM-37 logs every one,
// not just significant edits), so the list is collapsed to the most recent
// few by default rather than growing unbounded on the page.
const COLLAPSED_COUNT = 3;

export default function EventActivityHistory({ activity }) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max((activity?.length ?? 0) - COLLAPSED_COUNT, 0);
  const visible = expanded ? activity : activity?.slice(0, COLLAPSED_COUNT);

  return <section aria-labelledby="activity-history-heading">
    <h2 id="activity-history-heading">Activity history</h2>
    {activity == null && <p>Activity history is unavailable right now. Refresh the event to try again.</p>}
    {activity?.length === 0 && <p>No activity recorded yet.</p>}
    {activity?.length > 0 && <>
      <ol className="event-workspace-list">
        {visible.map(entry => <li key={entry.id}>
          <span>{ACTIONS[entry.action] ?? entry.action} · {formatWhen(entry.created_at)}</span>
          {entry.note && <span>{entry.action === "SAFETY_REJECTED" ? "Reason" : "Note"}: {entry.note}</span>}
        </li>)}
      </ol>
      {hiddenCount > 0 && (
        <button type="button" className="secondary" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
          {expanded ? "Show fewer" : `Show ${hiddenCount} more`}
        </button>
      )}
    </>}
  </section>;
}
