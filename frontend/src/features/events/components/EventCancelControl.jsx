import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { cancelEvent } from "../reviewService";

const ACTIVE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "CONFIRMED"];

// SCRUM-148 AC1/AC2: who may see this is decided by the page (the assigned
// coordinator, or the manager scope) - this component only gates on status,
// the same division EventDecisionControls already uses.
export default function EventCancelControl({ event, onCancelled }) {
  const { token } = useAuth();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!ACTIVE_STATUSES.includes(event.status)) return null;

  async function cancel() {
    if (!reason.trim()) return setReasonError("Give a reason for cancelling this event.");
    setReasonError("");
    setError("");
    setBusy(true);
    try {
      onCancelled(await cancelEvent(event.id, reason, token));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="cancel-event-heading">
    <h2 id="cancel-event-heading">Cancel event</h2>
    <p>Cancelling releases its venue bookings and equipment reservations for other events. This cannot be undone.</p>
    {error && <p role="alert">{error}</p>}
    <form>
      <label htmlFor="cancel-reason">Reason</label>
      <span id="cancel-reason-hint" className="field-hint">Required.</span>
      <textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}
        aria-invalid={Boolean(reasonError)}
        aria-describedby={reasonError ? "cancel-reason-hint cancel-reason-error" : "cancel-reason-hint"} />
      {reasonError && <p id="cancel-reason-error" className="field-error">{reasonError}</p>}
      <button type="button" disabled={busy} onClick={cancel}>
        {busy ? "Cancelling…" : "Cancel event"}
      </button>
    </form>
  </section>;
}
