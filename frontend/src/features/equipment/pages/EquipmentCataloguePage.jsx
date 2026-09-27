import { useAuth } from "../../auth/useAuth";
import { useEffect, useState } from "react";
import { fetchEquipmentCatalogue } from "../../../lib/api";
import "../equipment.css";

const EMPTY_EQUIPMENT = [];

// Scrum-29 follow-up: a plain read view of every equipment row's type,
// location and status - the piece coordinators and technical staff were
// missing to see for themselves why the request form's dropdown excludes an
// item (status not AVAILABLE, or committed to an overlapping request).
function EquipmentCataloguePage() {
  const { token } = useAuth();
  const [result, setResult] = useState(null);
  const current = result?.token === token;
  const equipment = current ? result.equipment : EMPTY_EQUIPMENT;
  const isLoading = !current;
  const loadError = current ? result.error : null;

  useEffect(() => {
    let active = true;
    fetchEquipmentCatalogue(token)
      .then((equipment) => { if (active) setResult({ token, equipment }); })
      .catch((error) => { if (active) setResult({ token, equipment: [], error: error.message }); });
    return () => { active = false; };
  }, [token]);

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
              <span className={`eq-status eq-status-equipment-${item.status.toLowerCase()}`}>
                {item.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default EquipmentCataloguePage;
