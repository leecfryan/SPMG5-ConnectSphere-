import { useState } from "react";

// Scrum-30: reserve flow is now two steps - pick a type, then review a
// single-unit reservation for it. The specific physical unit is picked
// automatically (the first one available for the window); the requester
// never sees or chooses between individual units or their locations.
// Replaces the old single per-unit dropdown + quantity input entirely;
// quantity_requested is always 1.
//
// Scrum-29's multi-unit capable availability check (equipment.validation.js's
// checkAvailability/findAvailableUnits) and quantity_requested column are
// deliberately left in place and untouched, just unreachable from this form -
// re-wiring multi-unit selection into the UI is Scrum-31's job.
function EquipmentRequestForm({ equipmentOptions, borrowWindow, onWindowChange, onSubmit, isSaving, saveError }) {
  const [selectedType, setSelectedType] = useState("");
  const [technicalRequirement, setTechnicalRequirement] = useState("");
  const { start, end } = borrowWindow;

  const types = [...new Set(equipmentOptions.map((item) => item.type))].sort();
  const itemsOfType = equipmentOptions.filter((item) => item.type === selectedType);
  const assignedItem = itemsOfType[0] || null;

  function handleSubmit(event) {
    event.preventDefault();
    if (!assignedItem) return;
    onSubmit({
      equipment_id: assignedItem.id,
      quantity_requested: 1,
      technical_requirement: technicalRequirement.trim() === "" ? undefined : technicalRequirement.trim(),
      borrow_start: new Date(start).toISOString(),
      borrow_end: new Date(end).toISOString(),
    });
  }

  return (
    <form className="eq-form" onSubmit={handleSubmit}>
      <div className="eq-form-grid">
        <label className="eq-field">
          Equipment type
          <span className="eq-select-wrap">
            <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} required>
              <option value="" disabled>Select a type...</option>
              {types.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <svg className="eq-field-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M5 7l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </label>

        <label className="eq-field">
          Borrow from
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => onWindowChange({ start: e.target.value, end })}
            required
          />
        </label>

        <label className="eq-field">
          Borrow until
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => onWindowChange({ start, end: e.target.value })}
            required
          />
        </label>

        <label className="eq-field eq-field-wide">
          Technical requirement
          <textarea
            rows="3"
            value={technicalRequirement}
            onChange={(e) => setTechnicalRequirement(e.target.value)}
            placeholder="e.g. Needs HDMI input and a wireless lapel mic."
          />
        </label>
      </div>

      {selectedType && (
        <div className="eq-available-items">
          {assignedItem ? (
            <p className="eq-reserve-summary">You have requested 1 {selectedType}.</p>
          ) : (
            <p className="eq-hint">None available for this type and window.</p>
          )}
        </div>
      )}

      {saveError && (
        <p className="eq-error" role="alert">
          Could not submit request: {saveError}
        </p>
      )}

      <button type="submit" className="eq-primary" disabled={isSaving || !assignedItem}>
        {isSaving ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

export default EquipmentRequestForm;
