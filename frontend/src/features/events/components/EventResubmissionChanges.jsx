import { formatWhen } from "../eventFormat";
import EventFieldChanges from "./EventFieldChanges";

export default function EventResubmissionChanges({ activity }) {
  const latest = activity?.find(entry => entry.action === "REQUEST_RESUBMITTED");
  if (!latest) return null;
  const description = !latest.baseline_source
    ? "Compared with the details when this request was returned for changes."
    : latest.baseline_source === "RECOVERED_RETURN"
      ? "Compared with the earliest retained return snapshot. Earlier edits are unavailable."
      : latest.baseline_source === "TRACKING_STARTED"
        ? "Compared with the details when change tracking began. Earlier edits are unavailable."
        : "Compared with the previous submitted or resubmitted version.";
  return <section className="event-resubmission" aria-labelledby="resubmission-heading">
    <p className="eyebrow">Last resubmission · {formatWhen(latest.created_at)}</p>
    <h2 id="resubmission-heading">Changes on resubmission</h2>
    <p>This is the saved comparison from that resubmission. Later edits appear in Saved organiser changes.</p>
    <p>{description}</p>
    {!latest.changes?.length ? <p>No request fields changed.</p> : <EventFieldChanges changes={latest.changes} />}
  </section>;
}
