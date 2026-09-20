import { useState } from "react";

function defaultBorrowWindow() {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  // datetime-local inputs want "YYYY-MM-DDTHH:mm" in local time, not ISO/UTC.
  const toLocalInput = (date) =>
    new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  return { start: toLocalInput(start), end: toLocalInput(end) };
}

function EquipmentRequestForm({ equipmentOptions, onSubmit, isSaving, saveError }) {
  const [equipmentId, setEquipmentId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [technicalRequirement, setTechnicalRequirement] = useState("");
  const [{ start, end }, setWindow] = useState(defaultBorrowWindow);

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
            onChange={(e) => setWindow((w) => ({ ...w, start: e.target.value }))}
            required
          />
        </label>

        <label className="eq-field">
          Borrow until
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setWindow((w) => ({ ...w, end: e.target.value }))}
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
