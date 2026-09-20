import { useSearchParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { useState, useEffect } from "react";
import {
  fetchEquipmentCatalogue,
  fetchEquipmentRequests,
  createEquipmentRequest,
  fetchEquipmentEvents,
} from "../../../lib/api";
import EquipmentRequestForm from "../components/EquipmentRequestForm";
import ClarificationThread from "../components/ClarificationThread";
import ErrorModal from "../../../components/ui/ErrorModal";
import "../equipment.css";

// Event URLs can be bookmarked; the picker uses backend-scoped assignments.
function EquipmentRequestPage() {
  const { token, user } = useAuth();
  const currentUserId = user.id;
  const [params, setParams] = useSearchParams();
  const eventId = params.get("event") || "";
  const setEventId = (id) => setParams(id ? { event: id } : {}, { replace: true });
  const [catalogue, setCatalogue] = useState(null);
  const equipmentOptions = catalogue?.token === token ? catalogue.equipment : [];
  const eventOptions = catalogue?.token === token ? catalogue.events : [];
  const catalogueError = catalogue?.token === token ? catalogue.error : null;
  const [requestResult, setRequestResult] = useState(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [forbiddenMessage, setForbiddenMessage] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestKey = JSON.stringify([eventId, token, refreshKey]);
  const current = requestResult?.key === requestKey;
  const requests = current ? requestResult.requests : [];
  const isLoadingRequests = Boolean(eventId) && !current;
  const loadError = current ? requestResult.error : null;
  useEffect(() => {
    let active = true;
    Promise.all([fetchEquipmentCatalogue(token), fetchEquipmentEvents(token)])
      .then(([equipment, events]) => { if (active) setCatalogue({ token, equipment, events }); })
      .catch((error) => { if (active) setCatalogue({ token, equipment: [], events: [], error: error.message }); });
    return () => { active = false; };
  }, [token]);
  useEffect(() => {
    if (!eventId) return;
    let active = true;
    fetchEquipmentRequests(eventId, token)
      .then((requests) => { if (active) setRequestResult({ key: requestKey, requests }); })
      .catch((error) => { if (active) setRequestResult({ key: requestKey, requests: [], error: error.message }); });
    return () => { active = false; };
  }, [eventId, token, requestKey]);

  function handleSubmit(fields) {
    setIsSaving(true);
    setSaveError(null);

    createEquipmentRequest(eventId, fields, token)
      .then(() => setRefreshKey((key) => key + 1))
      .catch((err) => {
        if (err.status === 403) {
          setForbiddenMessage(err.message);
        } else {
          setSaveError(err.message);
        }
      })
      .finally(() => setIsSaving(false));
  }

  function equipmentLabel(equipmentId) {
    const match = equipmentOptions.find((item) => item.id === equipmentId);
    return match ? match.type : equipmentId;
  }

  if (!token) {
    return (
      <div className="eq-page">
        <p className="eq-eyebrow">EQUIPMENT & LOGISTICS</p>
        <h1>Request equipment</h1>
        <div className="eq-card">
          <p>Sign in to request equipment for an event.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="eq-page">
      <p className="eq-eyebrow">EQUIPMENT & LOGISTICS</p>
      <h1>Request equipment</h1>
      <p className="eq-subheading">
        Record what an event needs so technical support can review and arrange it.
      </p>

      <div className="eq-card">
        <div className="eq-card-header">
          <h2>New request</h2>
        </div>

        {catalogueError && <p className="eq-error" role="alert">Could not load equipment or events: {catalogueError}</p>}
        <label className="eq-field">
          Assigned event
          <select value={eventOptions.some((event) => event.id === eventId) ? eventId : ""} onChange={(e) => setEventId(e.target.value)}>
            <option value="">Select an assigned event...</option>
            {eventOptions.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
        </label>
        <label className="eq-field eq-event-picker">
          Event id
          <input
            type="text"
            value={eventId}
            onChange={(e) => setEventId(e.target.value.trim())}
            placeholder="Paste the event's UUID"
          />
        </label>

        {!eventId ? (
          <p className="eq-hint">Enter an event id to submit or view its equipment requests.</p>
        ) : (
          <EquipmentRequestForm
            key={eventId + ":" + refreshKey}
            equipmentOptions={equipmentOptions}
            onSubmit={handleSubmit}
            isSaving={isSaving}
            saveError={saveError}
          />
        )}
      </div>

      {eventId && (
        <div className="eq-card">
          <div className="eq-card-header">
            <h2>Requests for this event</h2>
            <span className="eq-badge">{requests.length} requests</span>
          </div>

          {loadError && <p className="eq-error">Could not load: {loadError}</p>}
          {isLoadingRequests && <p className="eq-hint">Loading requests…</p>}

          {!isLoadingRequests && requests.length === 0 && !loadError && (
            <p className="eq-hint">No equipment requests yet for this event.</p>
          )}

          <ul className="eq-request-list">
            {requests.map((r) => (
              <li key={r.id} className="eq-request-row">
                <div>
                  <p className="eq-request-title">
                    {equipmentLabel(r.equipment_id)} × {r.quantity_requested}
                  </p>
                  {r.technical_requirement && (
                    <p className="eq-request-detail">{r.technical_requirement}</p>
                  )}
                </div>
                <span className={`eq-status eq-status-${r.status.toLowerCase()}`}>
                  {r.status}
                </span>
              </li>
            ))}
          </ul>

          <ClarificationThread
            key={eventId}
            eventId={eventId}
            lines={requests.map((r) => ({ id: r.id, label: equipmentLabel(r.equipment_id) }))}
            token={token}
            currentUserId={currentUserId}
          />
        </div>
      )}

      <ErrorModal
        open={forbiddenMessage !== null}
        title="Access denied"
        message={forbiddenMessage}
        onClose={() => setForbiddenMessage(null)}
      />
    </div>
  );
}

export default EquipmentRequestPage;
