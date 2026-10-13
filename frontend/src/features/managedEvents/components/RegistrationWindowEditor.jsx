import { useState } from "react";
import { updateRegistrationWindow } from "../managedEventsService";
import { useRegistrationWindow, formatRegistrationTime } from "../../registrations/useRegistrationWindow";
import {
  registrationEndsAfterEventStarts,
  registrationWindowValidationError,
  toLocalDateTimeInput,
} from "../../events/registrationWindowFields";

function fieldsFromEvent(event) {
  return {
    registration_start: toLocalDateTimeInput(event.registration_start),
    registration_end: toLocalDateTimeInput(event.registration_end),
  };
}

export default function RegistrationWindowEditor({ event, token, onSaved }) {
  const [fields, setFields] = useState(() => fieldsFromEvent(event));
  const [dirty, setDirty] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const windowState = useRegistrationWindow(
    event,
    event.server_time,
    event.server_time_received_at,
  );
  const isClosed = windowState.status === "closed";

  function update(field, value) {
    setFields((current) => ({ ...current, [field]: value }));
    setDirty((current) => new Set(current).add(field));
    setError("");
    setMessage("");
  }

  async function save(e) {
    e.preventDefault();
    const validation = registrationWindowValidationError(
      fields.registration_start,
      fields.registration_end,
    );
    if (validation) {
      setError(validation);
      return;
    }
    if (dirty.size === 0) {
      setMessage("No registration-window changes to save.");
      return;
    }

    const changes = Object.fromEntries([...dirty].map((field) => [field, fields[field]]));
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await updateRegistrationWindow(event.id, changes, token);
      setFields(fieldsFromEvent(saved));
      setDirty(new Set());
      onSaved(saved);
      setMessage("Registration window saved.");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="registration-window-editor form-section" onSubmit={save} aria-busy={busy}>
      <div className="registration-window-editor__header">
        <div>
          <h2>Registration window</h2>
          <p>Choose when attendees can register. Leave a date empty for no limit.</p>
        </div>
        <span className="registration-window-editor__timezone">Your local time</span>
      </div>
      {isClosed && (
        <p className="registration-window-closed" role="status">
          Registration closed on {formatRegistrationTime(event.registration_end)}. Set a new end date to reopen.
        </p>
      )}
      <div className="field-pair">
        <div className="registration-window-editor__field">
          <label htmlFor="managed-registration-start">Registration opens</label>
          <input
            id="managed-registration-start"
            name="registration_start"
            type="datetime-local"
            disabled={busy}
            value={fields.registration_start}
            onChange={(e) => update("registration_start", e.target.value)}
            aria-invalid={error && error.includes("start") ? "true" : undefined}
          />
          <span className="field-hint">Optional start date</span>
        </div>
        <div className="registration-window-editor__field">
          <label htmlFor="managed-registration-end">Registration closes</label>
          <input
            id="managed-registration-end"
            name="registration_end"
            type="datetime-local"
            disabled={busy}
            value={fields.registration_end}
            onChange={(e) => update("registration_end", e.target.value)}
            aria-invalid={error && error.includes("end") ? "true" : undefined}
          />
          <span className="field-hint">Optional closing date</span>
        </div>
      </div>
      {registrationEndsAfterEventStarts(fields.registration_end, event.start_time) && (
        <p className="field-hint">
          Registration closes after the event starts. This is allowed, but attendees may register after the event begins.
        </p>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      {message && <p className="assign-confirmation" role="status">{message}</p>}
      <div className="registration-window-editor__actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save registration window"}
        </button>
      </div>
    </form>
  );
}
