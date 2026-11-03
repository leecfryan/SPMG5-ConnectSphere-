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
// SCRUM-169: the type list comes from `allEquipment` (the full catalogue,
// unfiltered by this window) so a type with zero units free right now is
// still selectable and can show the "Out of Stock" state below - the old
// equipmentOptions-only list hid it entirely. The live count/warning itself
// stays keyed off `equipmentOptions` (window-filtered), and is a warning
// only: it never disables Submit (SCRUM-31 Decision 4; SCRUM-169 Decision 2
// in the task note).
function EquipmentRequestForm({ equipmentOptions, allEquipment, isAvailabilityUnknown, borrowWindow, onWindowChange, onSubmit, isSaving, saveError }) {
  const [selectedType, setSelectedType] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [isEssential, setIsEssential] = useState(false);
  const [technicalRequirement, setTechnicalRequirement] = useState("");
  const { start, end } = borrowWindow;

  const types = [...new Set(allEquipment.map((item) => item.type))].sort();

  // "Available now", not "available" - a PENDING sibling holds no unit
  // (SCRUM-31 Decision 3), so this count is "currently unreserved", not a
  // guarantee. isAvailabilityUnknown covers both "no result yet" and "the
  // fetch errored" - the parent's in-flight state, a fetch failure and a
  // real zero-unit result are all otherwise just an empty equipmentOptions
  // array, so the page's own error banner (shown above this form) is left
  // as the only message rather than stacking a false "Out of Stock" on it.
  const showAvailability = Boolean(selectedType) && !isAvailabilityUnknown;
  const availableCount = showAvailability
    ? equipmentOptions.filter((item) => item.type === selectedType).length
    : 0;
  const hasValidQuantity = Number.isInteger(quantity) && quantity >= 1;
  const isOutOfStock = showAvailability && availableCount === 0;
  const isShortfall = showAvailability && hasValidQuantity && availableCount > 0 && availableCount < quantity;
  // Essential is all-or-nothing at reserve time (planReservation): a
  // shortfall - including zero, which is just availableCount < quantity's
  // own zero case - means Reserve will refuse the whole group, not partially
  // fill it.
  const showEssentialWarning = showAvailability && isEssential && hasValidQuantity && availableCount < quantity;

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

      {showAvailability && (
        <div className="eq-availability">
          {isOutOfStock ? (
            <>
              <span className="eq-status eq-status-unavailable">Out of Stock</span>
              <p className="eq-hint">Out of Stock now. You can still submit, but it may be unfulfilled.</p>
            </>
          ) : isShortfall ? (
            <p className="eq-hint">Only {availableCount} available now, the rest may be unfulfilled.</p>
          ) : (
            <p className="eq-hint">{availableCount} available now.</p>
          )}
          {showEssentialWarning && (
            <p className="eq-hint eq-essential-warning">
              Essential: if there aren't enough units, nothing will be reserved and your request stays pending
              until enough are free.
            </p>
          )}
        </div>
      )}

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
