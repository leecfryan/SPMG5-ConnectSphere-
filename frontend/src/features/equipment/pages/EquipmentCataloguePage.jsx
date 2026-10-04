import { useAuth } from "../../auth/useAuth";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { fetchEquipmentCatalogue, updateEquipmentStatus, retireEquipment } from "../../../lib/api";
import RetireButton from "../components/RetireButton";
import "../equipment.css";

const EMPTY_EQUIPMENT = [];

// Scrum-30: the quick status change is for day-to-day operational condition
// only - UNAVAILABLE is reachable solely through the dedicated Retire action
// below, matching equipment.validation.js's OPERATIONAL_STATUSES restriction
// on the same PATCH /equipment/:id/status endpoint.
const OPERATIONAL_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "DAMAGED", "UNDER_MAINTENANCE"];

// Scrum-29 follow-up: every equipment row's type, location and status -
// technical staff can also change status here, since nothing in the app
// changes it automatically (see equipment-integration.md). Scrum-30: this
// page is Technical Support Staff only (equipment.review) - Event
// Coordinators no longer have a route to it.
function EquipmentCataloguePage() {
  const { token, hasPermission } = useAuth();
  const navigate = useNavigate();
  const canChangeStatus = hasPermission("equipment.review");
  const canManage = hasPermission("equipment.manage");
  const [result, setResult] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [showRetired, setShowRetired] = useState(false);
  const current = result?.token === token;
  const equipment = current ? result.equipment : EMPTY_EQUIPMENT;
  const isLoading = !current;
  const loadError = current ? result.error || actionError : null;
  const visibleEquipment = showRetired ? equipment : equipment.filter((item) => item.status !== "UNAVAILABLE");

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

  function handleRetire(id) {
    setSavingId(id);
    setActionError(null);
    retireEquipment(id, token)
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
          {canManage && (
            <Link to="/equipment/catalogue/new" className="eq-primary eq-header-action">
              Add equipment
            </Link>
          )}
          <span className="eq-badge">{visibleEquipment.length} units</span>
        </div>

        {loadError && <p className="eq-error" role="alert">Could not load equipment: {loadError}</p>}
        {isLoading && !loadError && <p className="eq-hint">Loading equipment…</p>}

        <label className="eq-toggle-row">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired equipment
        </label>

        {!isLoading && visibleEquipment.length === 0 && !loadError && (
          <p className="eq-hint">No equipment on record.</p>
        )}

        <ul className="eq-request-list">
          {visibleEquipment.map((item) => (
            <li key={item.id} className={`eq-request-row ${item.status === "UNAVAILABLE" ? "eq-request-row-retired" : ""}`}>
              <div>
                <p className="eq-request-title">{item.type}</p>
                {item.current_location && (
                  <p className="eq-request-detail">{item.current_location}</p>
                )}
              </div>
              <span className="eq-row-actions">
                {canChangeStatus && item.status !== "UNAVAILABLE" ? (
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
                        {OPERATIONAL_STATUSES.map((status) => (
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
                {canManage && item.status !== "UNAVAILABLE" && (
                  <>
                    <button type="button" className="eq-secondary" onClick={() => navigate(`/equipment/catalogue/${item.id}/edit`)}>
                      Edit
                    </button>
                    <RetireButton busy={savingId === item.id} onRetire={() => handleRetire(item.id)} />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default EquipmentCataloguePage;
