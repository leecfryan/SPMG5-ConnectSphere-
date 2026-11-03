import { useState } from "react";
import { IconAlert } from "./VenueIcons";

const SLOTS = ["am", "pm", "night"];
const SLOT_LABELS = { am: "AM (08:00 – 12:00)", pm: "PM (12:00 – 18:00)", night: "Night (18:00 – 23:00)" };

function VenueUnavailabilityForm({ onSubmit, onCancel, initialData, isSaving, saveError }) {
  const [startDate, setStartDate] = useState(initialData?.start_date ?? "");
  const [endDate, setEndDate] = useState(initialData?.end_date ?? "");
  const [slots, setSlots] = useState(() => new Set(initialData?.slots ?? []));
  const [reason, setReason] = useState(initialData?.reason ?? "");

  function toggleSlot(slot) {
    setSlots((prev) => {
      const next = new Set(prev);
      next.has(slot) ? next.delete(slot) : next.add(slot);
      return next;
    });
  }

  function handleSubmit() {
    onSubmit({
      start_date: startDate,
      end_date: endDate,
      slots: SLOTS.filter((s) => slots.has(s)),
      reason: reason.trim(),
    });
  }

  const isEdit = Boolean(initialData);

  return (
    <div className="v-stack">
      <section className="v-card">
        <div className="v-card-header">
          <h2 className="v-card-title">{isEdit ? "Edit period" : "Add unavailability period"}</h2>
          <p className="v-card-desc">
            Slots that fall in this period will show as unavailable on the calendar and new booking
            requests for them will be blocked.
          </p>
        </div>

        <div className="v-form-grid">
          <label className="v-field">
            <span className="v-label">Start date</span>
            <input
              className="v-input"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="v-field">
            <span className="v-label">End date</span>
            <input
              className="v-input"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>

        <fieldset style={{ border: "none", padding: 0, margin: "16px 0 0" }}>
          <legend className="v-label" style={{ marginBottom: 10 }}>Affected slots</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px" }}>
            {SLOTS.map((slot) => (
              <label key={slot} className="v-check">
                <input
                  type="checkbox"
                  checked={slots.has(slot)}
                  onChange={() => toggleSlot(slot)}
                />
                {SLOT_LABELS[slot]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="v-field" style={{ marginTop: 16 }}>
          <span className="v-label">Reason</span>
          <input
            className="v-input"
            type="text"
            placeholder="e.g. Maintenance, Renovation, Safety inspection"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </section>

      {saveError && (
        <p className="v-alert v-alert-error" role="alert">
          <IconAlert />
          <span>{saveError}</span>
        </p>
      )}

      <div className="v-card v-action-bar">
        <div className="v-form-actions">
          <button
            type="button"
            className="v-btn v-btn-secondary"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="v-btn v-btn-primary"
            onClick={handleSubmit}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : isEdit ? "Save changes" : "Add period"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default VenueUnavailabilityForm;
