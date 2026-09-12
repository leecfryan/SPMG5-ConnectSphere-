import { useState, useEffect } from "react";
import {
  fetchEquipmentTypes,
  fetchEquipmentRequests,
  createEquipmentRequest,
} from "../../../lib/api";
import EquipmentRequestForm from "../components/EquipmentRequestForm";

// No event-picker UI exists yet, so this page takes a plain event id input
// rather than inventing event navigation that's out of scope for this story.
//
// Every equipment endpoint now requires a signed-in session (see
// backend/src/routes/equipment.routes.js), so nothing here fetches without
// a token - not just the create action.
function EquipmentRequestPage({ token }) {
  const [eventId, setEventId] = useState("");
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [requests, setRequests] = useState([]);
  const [isLoadingTypes, setIsLoadingTypes] = useState(true);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [error, setError] = useState(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!token) return;
    setIsLoadingTypes(true);

    fetchEquipmentTypes(token)
      .then((data) => setEquipmentTypes(data))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoadingTypes(false));
  }, [token]);

  useEffect(() => {
    if (!token || !eventId) {
      setRequests([]);
      return;
    }
    setIsLoadingRequests(true);
    setError(null);

    fetchEquipmentRequests(eventId, token)
      .then((data) => setRequests(data))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoadingRequests(false));
  }, [eventId, token, refreshKey]);

  function handleSubmit(fields) {
    setIsSaving(true);
    setSaveError(null);

    createEquipmentRequest(eventId, fields, token)
      .then(() => setRefreshKey((key) => key + 1))
      .catch((err) => setSaveError(err.message))
      .finally(() => setIsSaving(false));
  }

  function typeName(typeId) {
    return equipmentTypes.find((type) => type.id === typeId)?.name || typeId;
  }

  if (!token) {
    return (
      <div className="equipment-requests">
        <h2>Equipment requests</h2>
        <p>Sign in to view and submit equipment requests.</p>
      </div>
    );
  }

  return (
    <div className="equipment-requests">
      <h2>Equipment requests</h2>

      <label className="equipment-event-picker">
        Event ID
        <input
          type="text"
          value={eventId}
          onChange={(e) => setEventId(e.target.value.trim())}
          placeholder="Paste the event's UUID"
        />
      </label>

      {isLoadingTypes && <p>Loading equipment types...</p>}
      {error && <p className="equipment-error">Could not load: {error}</p>}

      {!eventId && <p>Enter an event id to see and create equipment requests.</p>}

      {eventId && (
        <>
          {/* Submitting is Coordinator-only; a Technical Support Staff
              signed-in user will see this form but get a 403 from
              equipment_requests.create on submit - see auth/permissions.js. */}
          <EquipmentRequestForm
            // Remounts on a successful submit to clear its fields, since
            // this form (unlike VenueEditForm) stays on screen afterwards.
            key={refreshKey}
            equipmentTypes={equipmentTypes}
            onSubmit={handleSubmit}
            isSaving={isSaving}
            saveError={saveError}
          />

          {isLoadingRequests && <p>Loading requests...</p>}

          {!isLoadingRequests && requests.length === 0 && (
            <p>No equipment requests yet for this event.</p>
          )}

          <ul className="equipment-request-list">
            {requests.map((r) => (
              <li key={r.id}>
                {typeName(r.equipment_type_id)} — {r.quantity_requested}
                {r.technical_requirements ? ` (${r.technical_requirements})` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default EquipmentRequestPage;
