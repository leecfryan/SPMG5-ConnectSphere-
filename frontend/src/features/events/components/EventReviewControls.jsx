import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useApiResource } from "../../../hooks/useApiResource";
import { apiFetch } from "../../../lib/api";

export default function EventReviewControls({ event, onUpdated }) {
  const { token } = useAuth();
  const { data, loading, error: directoryError } = useApiResource("/api/event-workspace/coordinators");
  const [coordinatorId, setCoordinatorId] = useState(event.coordinator_id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function update(action, body) {
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/event-workspace/${event.id}/${action}`, token, { method: "PATCH", body });
      onUpdated();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section aria-label="Manager actions">
    <h2>Review and assignment</h2>
    {error && <p role="alert">{error}</p>}
    {event.status === "SUBMITTED" && <div className="event-actions">
      <button disabled={busy} onClick={() => update("decision", { decision: "accept" })}>Accept event</button>
      <button disabled={busy} onClick={() => update("decision", { decision: "reject" })}>Reject event</button>
    </div>}
    {event.status === "ACCEPTED" && <p>Accepted for planning. Registration remains closed until you open it.</p>}
    {event.status === "APPROVED" && <p>Registration is open to attendees.</p>}
    {["ACCEPTED", "APPROVED"].includes(event.status) && <form onSubmit={e => {
      e.preventDefault();
      update("coordinator", { coordinatorId, expectedCoordinatorId: event.coordinator_id || null });
    }}>
      <label htmlFor="coordinator">Event coordinator</label>
      <select id="coordinator" value={coordinatorId} onChange={e => setCoordinatorId(e.target.value)} disabled={busy || loading || Boolean(directoryError)} required>
        <option value="">Select a coordinator</option>
        {data?.coordinators.map(person => <option key={person.id} value={person.id}>{person.name} ({person.email})</option>)}
      </select>
      {directoryError && <p role="alert">{directoryError}</p>}
      {!loading && data?.coordinators.length === 0 && <p>No active coordinator accounts are available.</p>}
      <button disabled={busy || !coordinatorId || coordinatorId === event.coordinator_id}>Save coordinator assignment</button>
    </form>}
    {event.status === "ACCEPTED" && <div>
      <p>After coordinating the arrangements, open registration to make this event available to attendees.</p>
      <button disabled={busy || !event.coordinator_id} onClick={() => update("publication", { openRegistration: true })}>Open registration</button>
    </div>}
  </section>;
}
