import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { postponeEvent } from "../reviewService";

// SCRUM-149/117: the stages an event can be postponed from - an already-postponed
// event is excluded (see backend/src/modules/events/lifecycle.js#POSTPONABLE_STATUSES).
const POSTPONABLE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SAFETY_REVIEW", "CONFIRMED"];

// "2099-07-08T09:00" from a datetime-local field is a local time; the server takes an instant.
const toInstant = (local) => (local ? new Date(local).toISOString() : undefined);

// SCRUM-170 AC1: who may see this is decided by the page (the assigned
// coordinator only) - this component only gates on status, the same division
// EventCancelControl already uses. AC2: the new date is optional.
export default function EventPostponeControl({ event, onPostponed }) {
  const { token } = useAuth();
  const [reason, setReason] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [dateError, setDateError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!POSTPONABLE_STATUSES.includes(event.status)) return null;

  async function postpone() {
    const missingReason = !reason.trim();
    const halfDate = Boolean(newStart) !== Boolean(newEnd);
    setReasonError(missingReason ? "Give a reason for postponing this event." : "");
    setDateError(halfDate ? "Give both a new start and a new end, or leave both empty." : "");
    if (missingReason || halfDate) return;
    setError("");
    setBusy(true);
    try {
      onPostponed(await postponeEvent(event.id, reason, token, { newStart: toInstant(newStart), newEnd: toInstant(newEnd) }));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="postpone-event-heading">
    <h2 id="postpone-event-heading">Postpone event</h2>
    <p>Without a new date, its venue bookings and holds are released. With one, venues that still fit on the new date move there for Venue Staff to approve again and the rest are released. The organiser and registered attendees are told. This cannot be undone.</p>
    {error && <p role="alert">{error}</p>}
    <form>
      <label htmlFor="postpone-reason">Reason</label>
      <span id="postpone-reason-hint" className="field-hint">Required.</span>
      <textarea id="postpone-reason" value={reason} onChange={(e) => setReason(e.target.value)}
        aria-invalid={Boolean(reasonError)}
        aria-describedby={reasonError ? "postpone-reason-hint postpone-reason-error" : "postpone-reason-hint"} />
      {reasonError && <p id="postpone-reason-error" className="field-error">{reasonError}</p>}
      <div className="field-pair">
        <div>
          <label htmlFor="postpone-new-start">New start</label>
          <input id="postpone-new-start" type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)}
            aria-invalid={Boolean(dateError)} aria-describedby="postpone-date-hint" />
        </div>
        <div>
          <label htmlFor="postpone-new-end">New end</label>
          <input id="postpone-new-end" type="datetime-local" value={newEnd} onChange={(e) => setNewEnd(e.target.value)}
            aria-invalid={Boolean(dateError)} aria-describedby="postpone-date-hint" />
        </div>
      </div>
      <span id="postpone-date-hint" className="field-hint">Optional. Leave both empty if the new date isn't known yet.</span>
      {dateError && <p className="field-error" role="alert">{dateError}</p>}
      <button type="button" disabled={busy} onClick={postpone}>
        {busy ? "Postponing…" : "Postpone event"}
      </button>
    </form>
  </section>;
}
