import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { fetchEquipmentCatalogue, createEquipment, updateEquipment } from "../../../lib/api";
import EquipmentForm from "../components/EquipmentForm";
import "../equipment.css";

// Scrum-30 AC1: create and edit share one route component. Edit finds its
// record from the full catalogue fetch (GET /api/equipment) rather than a
// new by-id endpoint - the list is already fetched whole elsewhere in this
// feature (see EquipmentRequestPage's equipmentLabel) and is small enough
// that a second single-record route added nothing a client-side find can't.
function EquipmentFormPage({ mode }) {
  const { id } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [equipment, setEquipment] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (mode !== "edit") return;
    let active = true;
    fetchEquipmentCatalogue(token)
      .then((list) => {
        if (!active) return;
        const match = list.find((item) => item.id === id);
        if (!match) setLoadError("Equipment not found.");
        else setEquipment(match);
      })
      .catch((error) => { if (active) setLoadError(error.message); });
    return () => { active = false; };
  }, [mode, id, token]);

  function handleSubmit(fields) {
    setIsSaving(true);
    setSaveError(null);
    const save = mode === "edit" ? updateEquipment(id, fields, token) : createEquipment(fields, token);
    save
      .then(() => navigate("/equipment/catalogue"))
      .catch((error) => setSaveError(error.message))
      .finally(() => setIsSaving(false));
  }

  return (
    <div className="eq-page">
      <p className="eq-eyebrow">EQUIPMENT & LOGISTICS</p>
      <h1>{mode === "edit" ? "Edit equipment" : "Add equipment"}</h1>

      <div className="eq-card">
        {mode === "edit" && !equipment && !loadError && <p className="eq-hint">Loading…</p>}
        {loadError && <p className="eq-error" role="alert">{loadError}</p>}
        {(mode === "create" || equipment) && (
          <EquipmentForm
            mode={mode}
            initial={equipment}
            onSubmit={handleSubmit}
            onCancel={() => navigate("/equipment/catalogue")}
            isSaving={isSaving}
            saveError={saveError}
          />
        )}
      </div>
    </div>
  );
}

export default EquipmentFormPage;
