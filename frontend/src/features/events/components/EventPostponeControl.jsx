import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { postponeEvent } from "../reviewService";

// SCRUM-149: the four stages an event can be postponed from - without a
// known new date yet, so an already-postponed event is excluded (see
// backend/src/modules/events/lifecycle.js#POSTPONABLE_STATUSES).
const POSTPONABLE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "CONFIRMED"];

// SCRUM-149 AC1/AC3: who may see this is decided by the page (the assigned
// coordinator, or the manager scope) - this component only gates on status,
// the same division EventCancelControl already uses.
export default function EventPostponeControl({ event, onPostponed }) {
  const { token } = useAuth();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!POSTPONABLE_STATUSES.includes(event.status)) return null;

  async function postpone() {
    if (!reason.trim()) return setReasonError("Give a reason for postponing this event.");
    setReasonError("");
    setError("");
    setBusy(true);
    try {
      onPostponed(await postponeEvent(event.id, reason, token));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="postpone-event-heading">
    <h2 id="postpone-event-heading">Postpone event</h2>
    <p>Postponing releases its venue bookings for other events, without needing a new date yet. This cannot be undone.</p>
    {error && <p role="alert">{error}</p>}
    <form>
      <label htmlFor="postpone-reason">Reason</label>
      <span id="postpone-reason-hint" className="field-hint">Required.</span>
      <textarea id="postpone-reason" value={reason} onChange={(e) => setReason(e.target.value)}
        aria-invalid={Boolean(reasonError)}
        aria-describedby={reasonError ? "postpone-reason-hint postpone-reason-error" : "postpone-reason-hint"} />
      {reasonError && <p id="postpone-reason-error" className="field-error">{reasonError}</p>}
      <button type="button" disabled={busy} onClick={postpone}>
        {busy ? "Postponing…" : "Postpone event"}
      </button>
    </form>
  </section>;
}
