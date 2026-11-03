import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { approveSafetyArrangement, rejectSafetyArrangement } from "../safetyService";

// SCRUM-141 AC1/AC2: the Safety Officer approves (note optional) or rejects
// (reason required) the safety arrangement. The server re-checks the role and
// that the event is still under review, so these controls are convenience.
export default function SafetyDecisionControls({ eventId, onDecided }) {
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
    // Same rule as the server, so the officer hears it before a round trip.
    if (!note.trim()) return setNoteError("Give a reason for rejecting this safety arrangement.");
    setNoteError("");
    run(() => rejectSafetyArrangement(eventId, note, token));
  }

  return <section aria-labelledby="safety-decision-heading">
    <h2 id="safety-decision-heading">Safety decision</h2>
    <p>Approving moves the event into preparation. Rejecting sends it back to its coordinator with your reason.</p>
    {error && <p role="alert">{error}</p>}
    <form>
      <label htmlFor="safety-decision-note">Decision note</label>
      <span id="safety-decision-note-hint" className="field-hint">Required to reject. Optional to approve.</span>
      <textarea id="safety-decision-note" value={note} onChange={e => setNote(e.target.value)}
        aria-invalid={Boolean(noteError)}
        aria-describedby={noteError ? "safety-decision-note-hint safety-decision-note-error" : "safety-decision-note-hint"} />
      {noteError && <p id="safety-decision-note-error" className="field-error">{noteError}</p>}
      <div className="event-actions">
        <button type="button" disabled={busy} onClick={() => run(() => approveSafetyArrangement(eventId, note, token))}>Approve</button>
        <button type="button" disabled={busy} onClick={reject}>Reject</button>
      </div>
    </form>
  </section>;
}
