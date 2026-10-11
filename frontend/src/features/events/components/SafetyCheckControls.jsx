import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useApiResource } from "../../../hooks/useApiResource";
import { submitForSafetyCheck, withdrawFromSafetyCheck } from "../safetyService";

// SCRUM-139: submit an approved event for the Operational Safety Check, or
// withdraw it. The server re-checks the assignment and readiness, so these
// controls are convenience, not access control.
function useAction(onChanged, onFailed) {
  const { token } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(action) {
    setBusy(true);
    setError("");
    try { onChanged(await action(token)); }
    catch (failure) { setError(failure.message); onFailed?.(); }
    finally { setBusy(false); }
  }
  return { error, busy, run };
}

function Submit({ event, onChanged }) {
  const readiness = useApiResource(`/api/internal/events/${event.id}/safety-readiness`);
  // A refused submit means the arrangements changed, so the list is fetched again.
  const { error, busy, run } = useAction(onChanged, readiness.reload);
  const missing = readiness.data?.missing ?? [];

  return <section aria-labelledby="safety-check-heading">
    <h2 id="safety-check-heading">Operational Safety Check</h2>
    {error && <p role="alert">{error}</p>}
    {readiness.loading && <p role="status">Checking arrangements…</p>}
    {readiness.error && <>
      <p role="alert">{readiness.error}</p>
      <button type="button" onClick={readiness.reload}>Try again</button>
    </>}
    {readiness.data && (readiness.data.ready
      ? <p>Venue and technical arrangements are in place. Submitting locks them while the event is reviewed.</p>
      : <>
        <p>Finish these arrangements before submitting:</p>
        <ul aria-label="Missing arrangements">
          {missing.map((item, index) => <li key={index}>{item.label}: {item.reason}</li>)}
        </ul>
        <button type="button" onClick={readiness.reload}>Check again</button>
      </>)}
    <button type="button" disabled={busy || !readiness.data?.ready}
      onClick={() => run((token) => submitForSafetyCheck(event.id, token))}>
      {busy ? "Submitting…" : "Submit for safety check"}
    </button>
  </section>;
}

function Withdraw({ event, onChanged }) {
  const { error, busy, run } = useAction(onChanged);
  return <section aria-labelledby="safety-check-heading">
    <h2 id="safety-check-heading">Operational Safety Check</h2>
    <p>This event is under safety review. Venue and equipment arrangements are locked until you withdraw it.</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => run((token) => withdrawFromSafetyCheck(event.id, token))}>
      {busy ? "Withdrawing…" : "Withdraw from safety check"}
    </button>
  </section>;
}

export default function SafetyCheckControls({ event, onChanged }) {
  if (event.status === "APPROVED") return <Submit event={event} onChanged={onChanged} />;
  if (event.status === "SAFETY_REVIEW") return <Withdraw event={event} onChanged={onChanged} />;
  return null;
}
