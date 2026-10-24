import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { resubmitEventRequest } from "../eventsService";

export default function EventResubmitControl({ eventId, cycleId, onResubmitted }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function resubmit() {
    setBusy(true);
    setError("");
    const result = await resubmitEventRequest(eventId, cycleId, token);
    if (result.event) onResubmitted();
    else setError(result.message || result.errors.map(item => item.field.replaceAll("_", " ") + ": " + item.message).join("; "));
    setBusy(false);
  }
  return <div className="event-resubmit">
    <p>Ready for another review? Resubmit your saved details to the same coordinator.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <button type="button" className="primary" disabled={busy || !cycleId} onClick={resubmit}>
      {busy ? "Resubmitting…" : "Resubmit request"}
    </button>
  </div>;
}
