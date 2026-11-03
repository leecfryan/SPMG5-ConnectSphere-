import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useApiResource } from "../../../hooks/useApiResource";
import { confirmEvent } from "../safetyService";
import ArrangementChecklist from "./ArrangementChecklist";

// SCRUM-144 AC1-AC4: once the event has passed the safety check (PREPARATION),
// the assigned coordinator confirms it if nothing essential is outstanding.
// The server re-checks the assignment and readiness, so this is convenience.
export default function ConfirmEventControls({ event, onChanged }) {
  const { token } = useAuth();
  const readiness = useApiResource(`/api/internal/events/${event.id}/safety-readiness`);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError("");
    try { onChanged(await confirmEvent(event.id, token)); }
    // A refused confirm means the arrangements changed, so the list is fetched again.
    catch (failure) { setError(failure.message); readiness.reload(); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="confirm-event-heading">
    <h2 id="confirm-event-heading">Confirm event</h2>
    <p>The event passed its safety check. Confirm it once every essential arrangement is complete.</p>
    {error && <p role="alert">{error}</p>}
    {readiness.loading && <p role="status">Checking arrangements…</p>}
    {readiness.error && <>
      <p role="alert">{readiness.error}</p>
      <button type="button" onClick={readiness.reload}>Try again</button>
    </>}
    {readiness.data && <>
      <p>{readiness.data.ready ? "Every essential arrangement is complete." : "Finish these essential arrangements before confirming:"}</p>
      <ArrangementChecklist eventId={event.id} missing={readiness.data.missing} optional={readiness.data.optional}
        onChanged={readiness.reload} />
      {!readiness.data.ready && <button type="button" onClick={readiness.reload}>Check again</button>}
    </>}
    <button type="button" disabled={busy || !readiness.data?.ready} onClick={confirm}>
      {busy ? "Confirming…" : "Confirm event"}
    </button>
  </section>;
}
