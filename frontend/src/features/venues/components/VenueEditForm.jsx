import { useState } from "react";
import { IconAlert, IconArrowLeft } from "./VenueIcons";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

function buildInitialHours(operatingHours) {
  const result = {};
  for (const day of DAYS) {
    const entry = operatingHours[day];
    result[day] = {
      closed: !entry || entry.closed === true,
      open: entry && entry.open ? entry.open : "09:00",
      close: entry && entry.close ? entry.close : "18:00",
    };
  }
  return result;
}

function MinutesField({ label, hint, value, onChange }) {
  return (
    <label className="v-field">
      <span className="v-label">{label}</span>
      <span className="v-input-with-suffix">
        <input
          className="v-input"
          type="number"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="v-input-suffix">min</span>
      </span>
      <span className="v-hint">{hint}</span>
    </label>
  );
}

function VenueEditForm({ venue, onSave, onCancel, isSaving, saveError }) {
  const [hours, setHours] = useState(() => buildInitialHours(venue.operating_hours));
  const [setupMinutes, setSetupMinutes] = useState(String(venue.setup_minutes));
  const [teardownMinutes, setTeardownMinutes] = useState(String(venue.teardown_minutes));
  const [turnaroundMinutes, setTurnaroundMinutes] = useState(String(venue.turnaround_minutes));
  const [notes, setNotes] = useState(venue.notes || "");

  function updateDay(day, patch) {
    setHours((current) => ({ ...current, [day]: { ...current[day], ...patch } }));
  }

  function handleSubmit() {
    const operating_hours = {};
    for (const day of DAYS) {
      const entry = hours[day];
      operating_hours[day] = entry.closed
        ? { closed: true }
        : { open: entry.open, close: entry.close };
    }

    onSave({
      operating_hours,
      setup_minutes: Number(setupMinutes),
      teardown_minutes: Number(teardownMinutes),
      turnaround_minutes: Number(turnaroundMinutes),
      notes: notes.trim() === "" ? null : notes.trim(),
    });
  }

  return (
    <div className="venue-edit-form v-page-narrow">
      <button
        type="button"
        className="v-back"
        onClick={onCancel}
        disabled={isSaving}
      >
        <IconArrowLeft />
        Back to venue
      </button>

      <header className="v-page-header">
        <div>
          <p className="v-eyebrow">{venue.name}</p>
          <h1 className="v-title">Update operating information</h1>
          <p className="v-subtitle">
            Changes are shown straight away on the venue page and the
            availability calendar.
          </p>
        </div>
      </header>

      <div className="v-stack">
        {/* SCRUM-89: operating hours */}
        <section className="v-card">
          <div className="v-card-header">
            <h2 className="v-card-title">Operating hours</h2>
            <p className="v-card-desc">
              Slots outside these hours show as Closed on the calendar.
            </p>
          </div>

          <div>
            {DAYS.map((day) => (
              <div
                key={day}
                className={`v-hours-editor-row ${hours[day].closed ? "is-closed" : ""}`}
              >
                <span className="v-day-name">{DAY_LABELS[day]}</span>

                <label className="v-check">
                  <input
                    type="checkbox"
                    checked={hours[day].closed}
                    onChange={(e) => updateDay(day, { closed: e.target.checked })}
                  />
                  Closed
                </label>

                <div className="v-time-range">
                  <input
                    className="v-input"
                    type="time"
                    aria-label={`${DAY_LABELS[day]} opening time`}
                    value={hours[day].open}
                    disabled={hours[day].closed}
                    onChange={(e) => updateDay(day, { open: e.target.value })}
                  />
                  <span className="v-time-sep">to</span>
                  <input
                    className="v-input"
                    type="time"
                    aria-label={`${DAY_LABELS[day]} closing time`}
                    value={hours[day].close}
                    disabled={hours[day].closed}
                    onChange={(e) => updateDay(day, { close: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* SCRUM-90: setup, teardown, turnaround */}
        <section className="v-card">
          <div className="v-card-header">
            <h2 className="v-card-title">Setup requirements</h2>
            <p className="v-card-desc">
              Time Venue Staff need around every booking.
            </p>
          </div>

          <div className="v-form-grid">
            <MinutesField
              label="Setup (minutes)"
              hint="Before the event starts"
              value={setupMinutes}
              onChange={setSetupMinutes}
            />
            <MinutesField
              label="Teardown (minutes)"
              hint="After the event ends"
              value={teardownMinutes}
              onChange={setTeardownMinutes}
            />
            <MinutesField
              label="Turnaround (minutes)"
              hint="Between back-to-back bookings"
              value={turnaroundMinutes}
              onChange={setTurnaroundMinutes}
            />
          </div>
        </section>

        <section className="v-card">
          <label className="v-field">
            <span className="v-card-title">Notes</span>
            <span className="v-card-desc">
              Anything organisers should know, such as loading bay access.
            </span>
            <textarea
              className="v-input"
              rows="3"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </section>

        {saveError && (
          <p className="v-alert v-alert-error" role="alert">
            <IconAlert />
            <span>Could not save: {saveError}</span>
          </p>
        )}

        <div className="v-card v-action-bar">
          <p className="v-action-bar-note">
            Editing {venue.name}
          </p>
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
              {isSaving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VenueEditForm;
