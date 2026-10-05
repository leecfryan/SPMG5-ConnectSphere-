import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { approveEvent, rejectEvent, startReview } from "../reviewService";

// SCRUM-98/99: the assigned coordinator starts the review, then approves or
// rejects. The server re-checks the assignment on every action, so showing
// these controls is convenience, not access control.
//
// Deliberately absent: confirming an approved event (APPROVED -> CONFIRMED) and
// withdrawal (discussion #103) belong to later stories.
export default function EventDecisionControls({ event, onDecided }) {
  const { token } = useAuth();
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action) {
    setBusy(true);
    setError("");
    try { onDecided(await action()); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  function reject() {
    // Same rule as the server, so the coordinator hears it before a round trip.
    if (!note.trim()) return setNoteError("Give a reason for rejecting this request.");
    setNoteError("");
    run(() => rejectEvent(event.id, note, token));
  }

  if (event.status === "SUBMITTED") return <section aria-labelledby="start-review-heading">
    <h2 id="start-review-heading">Review</h2>
    <p>Start the review before you approve or reject this request. Its status changes to Under review.</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => run(() => startReview(event.id, token))}>
      {busy ? "Starting review…" : "Start review"}
    </button>
  </section>;

  if (event.status !== "UNDER_REVIEW") return null;

  // SCRUM-99 AC2: approval moves the event into planning and books nothing.
  return <section aria-labelledby="decision-heading">
    <h2 id="decision-heading">Review decision</h2>
    <p>Approving moves the event into planning so its venue and equipment can be arranged. It does not book anything.</p>
    {error && <p role="alert">{error}</p>}
    <form>
      <label htmlFor="decision-note">Decision note</label>
      <span id="decision-note-hint" className="field-hint">Required to reject. Optional to approve.</span>
      <textarea id="decision-note" value={note} onChange={e => setNote(e.target.value)}
        aria-invalid={Boolean(noteError)}
        aria-describedby={noteError ? "decision-note-hint decision-note-error" : "decision-note-hint"} />
      {noteError && <p id="decision-note-error" className="field-error">{noteError}</p>}
      <div className="event-actions">
        <button type="button" disabled={busy} onClick={() => run(() => approveEvent(event.id, note, token))}>Approve</button>
        <button type="button" disabled={busy} onClick={reject}>Reject</button>
      </div>
    </form>
  </section>;
}
