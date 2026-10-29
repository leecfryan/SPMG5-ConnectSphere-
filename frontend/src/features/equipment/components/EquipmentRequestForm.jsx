import { useState } from "react";

// SCRUM-31: back to asking for a type + a desired quantity - no specific
// unit is picked here any more (Technical Support's Reserve action assigns
// real units later, up to however many are actually available). Submitting
// never checks or blocks on availability (Decision 4): asking for more than
// is currently free is accepted, and the shortfall is handled by Reserve,
// not here. The "Essential" checkbox (default off) makes the whole request
// all-or-nothing at reserve time instead of allowing partial fulfillment -
// see equipment.validation.js's planReservation.
//
// The type list itself still comes from equipmentOptions (units free for
// this exact window) - a type with zero units free right now won't appear
// to pick at all, even though an over-request would otherwise be accepted.
// Showing every catalogue type regardless of current availability, plus a
// live count next to it, is SCRUM-169's job (see the task note's SCRUM-169
// interaction section), not reopened here.
function EquipmentRequestForm({ equipmentOptions, borrowWindow, onWindowChange, onSubmit, isSaving, saveError }) {
  const [selectedType, setSelectedType] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [isEssential, setIsEssential] = useState(false);
  const [technicalRequirement, setTechnicalRequirement] = useState("");
  const { start, end } = borrowWindow;

  const types = [...new Set(equipmentOptions.map((item) => item.type))].sort();

  function handleSubmit(event) {
    event.preventDefault();
    if (!selectedType || !Number.isInteger(quantity) || quantity < 1) return;
    onSubmit({
      equipment_type: selectedType,
      quantity_requested: quantity,
      is_essential: isEssential,
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
          Quantity
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            required
          />
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

        <label className="eq-field eq-field-wide eq-field-checkbox">
          <input
            type="checkbox"
            checked={isEssential}
            onChange={(e) => setIsEssential(e.target.checked)}
          />
          Essential — the event can't go ahead without the full amount (no partial fulfillment)
        </label>
      </div>

      {saveError && (
        <p className="eq-error" role="alert">
          Could not submit request: {saveError}
        </p>
      )}

      <button type="submit" className="eq-primary" disabled={isSaving || !selectedType || !Number.isInteger(quantity) || quantity < 1}>
        {isSaving ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

export default EquipmentRequestForm;
