import { useAuth } from "../../auth/useAuth";
import { useEffect, useState } from "react";
import { fetchEquipmentCatalogue, updateEquipmentStatus } from "../../../lib/api";
import "../equipment.css";

const EMPTY_EQUIPMENT = [];

// Matches backend/src/modules/equipment/equipment.validation.js's
// EQUIPMENT_STATUSES - kept in sync there, not derived from an API call,
// since this is a fixed, small enum with no catalogue endpoint of its own.
const EQUIPMENT_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "UNAVAILABLE", "DAMAGED", "UNDER_MAINTENANCE"];

// Scrum-29 follow-up: every equipment row's type, location and status -
// technical staff can also change status here, since nothing in the app
// changes it automatically (see equipment-integration.md). Coordinators
// (equipment.read but not equipment.review) see the same list read-only.
function EquipmentCataloguePage() {
  const { token, hasPermission } = useAuth();
  const canChangeStatus = hasPermission("equipment.review");
  const [result, setResult] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const current = result?.token === token;
  const equipment = current ? result.equipment : EMPTY_EQUIPMENT;
  const isLoading = !current;
  const loadError = current ? result.error || actionError : null;

  useEffect(() => {
    let active = true;
    fetchEquipmentCatalogue(token)
      .then((equipment) => { if (active) setResult({ token, equipment }); })
      .catch((error) => { if (active) setResult({ token, equipment: [], error: error.message }); });
    return () => { active = false; };
  }, [token]);

  function handleStatusChange(id, status) {
    setSavingId(id);
    setActionError(null);
    updateEquipmentStatus(id, status, token)
      .then((updated) => {
        setResult((prev) => ({
          ...prev,
          equipment: prev.equipment.map((item) => (item.id === id ? { ...item, status: updated.status } : item)),
        }));
      })
      .catch((error) => setActionError(error.message))
      .finally(() => setSavingId(null));
  }

  return (
    <div className="eq-page">
      <p className="eq-eyebrow">EQUIPMENT & LOGISTICS</p>
      <h1>Equipment catalogue</h1>
      <p className="eq-subheading">
        Every equipment unit's type, location and current status.
      </p>

      <div className="eq-card">
        <div className="eq-card-header">
          <h2>All equipment</h2>
          <span className="eq-badge">{equipment.length} units</span>
        </div>

        {loadError && <p className="eq-error" role="alert">Could not load equipment: {loadError}</p>}
        {isLoading && !loadError && <p className="eq-hint">Loading equipment…</p>}
        {!isLoading && equipment.length === 0 && !loadError && (
          <p className="eq-hint">No equipment on record.</p>
        )}

        <ul className="eq-request-list">
          {equipment.map((item) => (
            <li key={item.id} className="eq-request-row">
              <div>
                <p className="eq-request-title">{item.type}</p>
                {item.current_location && (
                  <p className="eq-request-detail">{item.current_location}</p>
                )}
              </div>
              {canChangeStatus ? (
                <span className="eq-line-status">
                  <span className={`eq-status eq-status-equipment-${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                  <span className="eq-select-wrap">
                    <select
                      aria-label={`Status for ${item.type}`}
                      value={item.status}
                      disabled={savingId === item.id}
                      onChange={(e) => handleStatusChange(item.id, e.target.value)}
                    >
                      {EQUIPMENT_STATUSES.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <svg className="eq-field-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                      <path d="M5 7l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </span>
              ) : (
                <span className={`eq-status eq-status-equipment-${item.status.toLowerCase()}`}>
                  {item.status}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default EquipmentCataloguePage;
