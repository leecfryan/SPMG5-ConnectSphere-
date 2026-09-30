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

// datetime-local inputs want "YYYY-MM-DDTHH:mm" in local time, not ISO/UTC.
function toLocalInput(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function toIso(localDatetimeValue) {
  return new Date(localDatetimeValue).toISOString();
}

function fallbackWindow() {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  return { start: toLocalInput(start), end: toLocalInput(end) };
}

// Scrum-29 follow-up: default the request's borrow window to the selected
// event's own timing, +/-30 minutes for setup/teardown, instead of an
// unrelated hardcoded default. Falls back when an event has no schedule
// (start_time/end_time are nullable) - the coordinator can still adjust
// either field in the form.
function defaultWindowForEvent(event) {
  if (!event.start_time || !event.end_time) return fallbackWindow();
  const start = new Date(event.start_time);
  start.setMinutes(start.getMinutes() - 30);
  const end = new Date(event.end_time);
  end.setMinutes(end.getMinutes() + 30);
  return { start: toLocalInput(start), end: toLocalInput(end) };
}

// Event URLs can be bookmarked; the picker uses backend-scoped assignments.
// Coordinators select from that list only - there is no free-text event id
// entry, so every eventId here is either empty or one of their own assignments.
function EquipmentRequestPage() {
  const { token, user } = useAuth();
  const currentUserId = user.id;
  const [params, setParams] = useSearchParams();
  const eventId = params.get("event") || "";
  const setEventId = (id) => setParams(id ? { event: id } : {}, { replace: true });
  const [catalogue, setCatalogue] = useState(null);
  const catalogueLoaded = catalogue?.token === token;
  const allEquipment = catalogueLoaded ? catalogue.equipment : [];
  const eventOptions = catalogueLoaded ? catalogue.events : [];
  const catalogueError = catalogueLoaded ? catalogue.error : null;
  const selectedEvent = eventOptions.find((event) => event.id === eventId) || null;

  // Scrum-29 follow-up: the borrow window lives here (not in the form) so it
  // can also drive the live-filtered equipment fetch below. Recomputed
  // during render (not in an effect - React's recommended pattern for
  // "reset derived state when its source changes") whenever the resolved
  // event changes, including the moment the assigned-events fetch finishes
  // and resolves an eventId that was already in the URL.
  const derivedWindowKey = `${eventId}|${catalogueLoaded}`;
  const [lastDerivedWindowKey, setLastDerivedWindowKey] = useState(derivedWindowKey);
  const [borrowWindow, setBorrowWindow] = useState(() => (selectedEvent ? defaultWindowForEvent(selectedEvent) : null));
  if (derivedWindowKey !== lastDerivedWindowKey) {
    setLastDerivedWindowKey(derivedWindowKey);
    setBorrowWindow(selectedEvent ? defaultWindowForEvent(selectedEvent) : null);
  }

  // Scrum-29 AC2/AC3/AC4: only equipment actually bookable for the current
  // borrow window - re-fetched whenever that window changes, so editing the
  // times live-updates the dropdown instead of only failing at submit time.
  const windowKey = borrowWindow ? [eventId, borrowWindow.start, borrowWindow.end].join("|") : null;
  const [availableResult, setAvailableResult] = useState(null);
  useEffect(() => {
    if (!borrowWindow) return;
    let active = true;
    fetchEquipmentCatalogue(token, { start: toIso(borrowWindow.start), end: toIso(borrowWindow.end) })
      .then((equipment) => { if (active) setAvailableResult({ key: windowKey, equipment }); })
      .catch((error) => { if (active) setAvailableResult({ key: windowKey, equipment: [], error: error.message }); });
    return () => { active = false; };
  }, [windowKey, token, borrowWindow]);
  const availableEquipment = availableResult?.key === windowKey ? availableResult.equipment : [];
  const availabilityError = availableResult?.key === windowKey ? availableResult.error : null;

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
    const match = allEquipment.find((item) => item.id === equipmentId);
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
        {!eventId ? (
          <p className="eq-hint">Select an assigned event to submit or view its equipment requests.</p>
        ) : !catalogueLoaded ? (
          <p className="eq-hint">Loading your assigned events…</p>
        ) : !selectedEvent ? (
          <p className="eq-hint">This event is not assigned to you.</p>
        ) : !borrowWindow ? (
          <p className="eq-hint">Loading event timing…</p>
        ) : (
          <>
            {availabilityError && (
              <p className="eq-error" role="alert">Could not check equipment availability: {availabilityError}</p>
            )}
            <EquipmentRequestForm
              key={eventId + ":" + refreshKey}
              equipmentOptions={availableEquipment}
              borrowWindow={borrowWindow}
              onWindowChange={setBorrowWindow}
              onSubmit={handleSubmit}
              isSaving={isSaving}
              saveError={saveError}
            />
          </>
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
