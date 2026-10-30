import { useRef, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { decideChangeRequest } from "../reviewService";
import { formatWhen } from "../eventFormat";
import EventFieldChanges from "./EventFieldChanges";

// SCRUM-165: displayed to the assigned coordinator when a pending change request exists.
// Mirrors eventWorkspace.service.js SIGNIFICANT_FIELDS: if any of these change on an
// APPROVED event, approving regresses it to SUBMITTED.
const SIGNIFICANT_FIELDS = new Set(["start_time", "end_time", "venue_requirements", "expected_attendance"]);

export default function ChangeRequestDecisionControls({ event, onDecided }) {
  const { token } = useAuth();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  if (!event.pending_change_request) return null;

  const { proposed_changes, reason: orgReason, requested_at } = event.pending_change_request;
  const changedKeys = Object.keys(proposed_changes);
  const fieldChanges = changedKeys.map(key => ({ field: key, before: event[key], after: proposed_changes[key] }));
  const willRegress = event.status === "APPROVED" &&
    changedKeys.some(f => SIGNIFICANT_FIELDS.has(f) && proposed_changes[f] !== event[f]);

  async function decide(decision) {
    if (inFlight.current) return;
    if (!reason.trim()) { setReasonError("A reason is required."); return; }
    setReasonError("");
    setError("");
    inFlight.current = true;
    setBusy(true);
    try {
      onDecided(await decideChangeRequest(event.id, decision, reason, token));
    } catch (failure) {
      setError(failure.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="event-review-decision" aria-labelledby="decide-cr-heading">
      <p className="eyebrow">Pending change request</p>
      <h2 id="decide-cr-heading">Change request from organiser</h2>
      <p>Submitted: {formatWhen(requested_at)}</p>
      <p>Organiser&apos;s reason: {orgReason}</p>
      {fieldChanges.length > 0 && <EventFieldChanges changes={fieldChanges} />}
      {willRegress && (
        <p role="note">Approving this change will return the event to Submitted for re-review, because it affects significant details (dates, expected attendance, or venue requirements). Arrangements stay in place until the coordinator re-approves.</p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <form aria-busy={busy}>
        <label htmlFor="decide-cr-reason">Decision reason</label>
        <span id="decide-cr-reason-hint" className="field-hint">Required for both approve and reject.</span>
        <textarea
          id="decide-cr-reason"
          rows={4}
          disabled={busy}
          value={reason}
          onChange={e => setReason(e.target.value)}
          aria-invalid={Boolean(reasonError)}
          aria-describedby={reasonError ? "decide-cr-reason-hint decide-cr-reason-error" : "decide-cr-reason-hint"}
        />
        {reasonError && <p id="decide-cr-reason-error" className="field-error">{reasonError}</p>}
        <div className="event-review-outcomes">
          <span>Accept or decline this change?</span>
          <div className="event-actions">
            <button className="secondary" type="button" disabled={busy} onClick={() => decide("approve")}>
              {busy ? "Saving…" : "Approve change"}
            </button>
            <button className="secondary event-review-reject" type="button" disabled={busy} onClick={() => decide("reject")}>
              {busy ? "Saving…" : "Reject change"}
            </button>
          </div>
        </div>
        {busy && <p className="status-line" role="status">Saving your decision…</p>}
      </form>
    </section>
  );
}
