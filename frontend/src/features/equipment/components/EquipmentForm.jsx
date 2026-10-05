import { useState } from "react";

// Scrum-30 AC1/AC2: shared by the Add and Edit pages. Create omits the status
// field entirely (new records start AVAILABLE, the schema's own default);
// edit shows status restricted to OPERATIONAL_STATUSES - matches
// equipment.validation.js's quick-status endpoint: UNAVAILABLE is reachable
// only through the dedicated Retire action, never this form.
const OPERATIONAL_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "DAMAGED", "UNDER_MAINTENANCE"];

function EquipmentForm({ mode, initial, onSubmit, onCancel, isSaving, saveError }) {
  const [type, setType] = useState(initial?.type || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [currentLocation, setCurrentLocation] = useState(initial?.current_location || "");
  const [status, setStatus] = useState(initial?.status && initial.status !== "UNAVAILABLE" ? initial.status : "AVAILABLE");

  function handleSubmit(event) {
    event.preventDefault();
    const fields = {
      type: type.trim(),
      current_location: currentLocation.trim(),
      description: description.trim() === "" ? null : description.trim(),
    };
    if (mode === "edit") fields.status = status;
    onSubmit(fields);
  }

  return (
    <form className="eq-form" onSubmit={handleSubmit}>
      <div className="eq-form-grid">
        <label className="eq-field">
          Type
          <input type="text" value={type} onChange={(e) => setType(e.target.value)} required />
        </label>

        <label className="eq-field">
          Location
          <input type="text" value={currentLocation} onChange={(e) => setCurrentLocation(e.target.value)} required />
        </label>

        {mode === "edit" && (
          <label className="eq-field">
            Status
            <span className="eq-select-wrap">
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {OPERATIONAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <svg className="eq-field-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                <path d="M5 7l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </label>
        )}

        <label className="eq-field eq-field-wide">
          Description
          <textarea rows="3" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 4K, ceiling-mounted" />
        </label>
      </div>

      {saveError && <p className="eq-error" role="alert">Could not save: {saveError}</p>}

      <div className="eq-form-actions">
        <button type="button" className="eq-secondary" onClick={onCancel} disabled={isSaving}>
          Cancel
        </button>
        <button type="submit" className="eq-primary" disabled={isSaving || !type.trim() || !currentLocation.trim()}>
          {isSaving ? "Saving…" : mode === "edit" ? "Save changes" : "Add equipment"}
        </button>
      </div>
    </form>
  );
}

export default EquipmentForm;
