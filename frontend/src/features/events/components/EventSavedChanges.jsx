import { formatWhen } from "../eventFormat";
import EventFieldChanges from "./EventFieldChanges";

const DESCRIPTIONS = {
  SUBMITTED: "Compared with the last submitted version.",
  RESUBMITTED: "Compared with the last resubmitted version.",
  RECOVERED_RETURN: "Compared with the earliest retained return snapshot. Earlier edits are unavailable.",
  TRACKING_STARTED: "Compared with the details when change tracking began. Earlier edits are unavailable.",
};

export default function EventSavedChanges({ comparison }) {
  if (!comparison) return <p>Saved-edit comparison is unavailable. Refresh the event to try again.</p>;
  if (!comparison.changes.length) return null;
  return <section className="event-resubmission" aria-labelledby="saved-changes-heading">
    <p className="eyebrow">Current saved details</p>
    <h2 id="saved-changes-heading">Saved organiser changes</h2>
    <p>{DESCRIPTIONS[comparison.source] || "Compared with the retained request version."} Baseline: {formatWhen(comparison.version_at)}</p>
    <p>These edits have been saved. Saving alone does not change the request status.</p>
    <EventFieldChanges changes={comparison.changes} />
  </section>;
}
