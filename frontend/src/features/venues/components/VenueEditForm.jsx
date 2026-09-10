import { useState } from "react";

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
    <div className="venue-edit-form">
      <h2>Update operating information</h2>
      <p>{venue.name}</p>

      {/* SCRUM-89: operating hours */}
      <section>
        <h3>Operating hours</h3>
        <table>
          <tbody>
            {DAYS.map((day) => (
              <tr key={day}>
                <td>{DAY_LABELS[day]}</td>
                <td>
                  <label>
                    <input
                      type="checkbox"
                      checked={hours[day].closed}
                      onChange={(e) => updateDay(day, { closed: e.target.checked })}
                    />
                    Closed
                  </label>
                </td>
                <td>
                  <input
                    type="time"
                    value={hours[day].open}
                    disabled={hours[day].closed}
                    onChange={(e) => updateDay(day, { open: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="time"
                    value={hours[day].close}
                    disabled={hours[day].closed}
                    onChange={(e) => updateDay(day, { close: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* SCRUM-90: setup, teardown, turnaround */}
      <section>
        <h3>Setup requirements</h3>
        <label>
          Setup (minutes)
          <input
            type="number" min="0"
            value={setupMinutes}
            onChange={(e) => setSetupMinutes(e.target.value)}
          />
        </label>
        <label>
          Teardown (minutes)
          <input
            type="number" min="0"
            value={teardownMinutes}
            onChange={(e) => setTeardownMinutes(e.target.value)}
          />
        </label>
        <label>
          Turnaround (minutes)
          <input
            type="number" min="0"
            value={turnaroundMinutes}
            onChange={(e) => setTurnaroundMinutes(e.target.value)}
          />
        </label>
      </section>

      <section>
        <h3>Notes</h3>
        <textarea
          rows="3"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>

      {saveError && <p className="venue-error">Could not save: {saveError}</p>}

      <button type="button" onClick={handleSubmit} disabled={isSaving}>
        {isSaving ? "Saving..." : "Save changes"}
      </button>
      <button type="button" onClick={onCancel} disabled={isSaving}>
        Cancel
      </button>
    </div>
  );
}

export default VenueEditForm;