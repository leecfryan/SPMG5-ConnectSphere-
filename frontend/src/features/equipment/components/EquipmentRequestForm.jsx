import { useState } from "react";

// Scrum-29 follow-up: the borrow window is now owned by EquipmentRequestPage
// (defaulted from the selected event's own timing, +/-30 minutes) so it can
// also drive the live equipment-availability fetch there. This form only
// renders it and reports edits back up - it no longer invents its own
// unrelated default.
function EquipmentRequestForm({ equipmentOptions, borrowWindow, onWindowChange, onSubmit, isSaving, saveError }) {
  const [equipmentId, setEquipmentId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [technicalRequirement, setTechnicalRequirement] = useState("");
  const { start, end } = borrowWindow;

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      equipment_id: equipmentId,
      quantity_requested: Number(quantity),
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
            <select
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              required
            >
              <option value="" disabled>
                Select equipment...
              </option>
              {equipmentOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.type}
                  {item.current_location ? ` — ${item.current_location}` : ""}
                </option>
              ))}
            </select>
            <svg className="eq-field-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path d="M5 7l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </label>

        <label className="eq-field">
          Quantity required
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
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
      </div>

      {saveError && (
        <p className="eq-error" role="alert">
          Could not submit request: {saveError}
        </p>
      )}

      <button type="submit" className="eq-primary" disabled={isSaving || !equipmentId}>
        {isSaving ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

export default EquipmentRequestForm;
