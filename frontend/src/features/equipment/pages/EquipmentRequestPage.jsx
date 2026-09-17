import { useState, useEffect } from "react";
import {
  fetchEquipmentCatalogue,
  fetchEquipmentRequests,
  createEquipmentRequest,
} from "../../../lib/api";
import EquipmentRequestForm from "../components/EquipmentRequestForm";
import ErrorModal from "../../../components/ui/ErrorModal";
import "../equipment.css";

// No event-picker UI exists yet in the app (App.jsx has no event navigation),
// so this page takes a plain event id input rather than inventing that flow -
// it's out of scope for this page, which is only the coordinator's equipment
// request form. Wiring this into a real event page is future work.
function EquipmentRequestPage({ token }) {
  const [eventId, setEventId] = useState("");
  const [equipmentOptions, setEquipmentOptions] = useState([]);
  const [requests, setRequests] = useState([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [forbiddenMessage, setForbiddenMessage] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!token) return;
    fetchEquipmentCatalogue(token)
      .then((data) => setEquipmentOptions(data))
      .catch((err) => setLoadError(err.message));
  }, [token]);

  useEffect(() => {
    // The request list is only rendered while eventId is set (see JSX below),
    // so there is nothing to clear when it isn't - no setState needed here.
    if (!token || !eventId) return;
    setIsLoadingRequests(true);
    setLoadError(null);

    fetchEquipmentRequests(eventId, token)
      .then((data) => setRequests(data))
      .catch((err) => setLoadError(err.message))
      .finally(() => setIsLoadingRequests(false));
  }, [eventId, token, refreshKey]);

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
            key={refreshKey}
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
