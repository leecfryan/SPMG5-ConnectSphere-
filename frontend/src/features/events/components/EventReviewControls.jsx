import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useApiResource } from "../../../hooks/useApiResource";
import { apiFetch } from "../../../lib/api";

// Matches ACTIVE_STATUSES in backend/src/modules/events/lifecycle.js.
const ASSIGNABLE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "CONFIRMED"];

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
  // Approval is the assigned coordinator's decision (SCRUM-98/99), so the manager only assigns.
  return <section aria-label="Manager actions">
    <h2>Coordinator assignment</h2>
    {error && <p role="alert">{error}</p>}
    {event.status === "REJECTED" && <p>This request was rejected, so it cannot be reassigned.</p>}
    {ASSIGNABLE_STATUSES.includes(event.status) && <form onSubmit={e => {
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
  </section>;
}
