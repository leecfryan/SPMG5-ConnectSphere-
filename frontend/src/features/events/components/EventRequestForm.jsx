import { useRef, useState } from "react";
import { EVENT_LIMITS, submitEventRequest } from "../eventsService";

// Mirrors WRITABLE_COLS in backend/src/modules/events/events.repository.js. The
// backend ignores anything outside that list, so an extra key here is inert -
// a missing one silently drops what the organiser typed.
const EMPTY = {
  name: "",
  purpose: "",
  description: "",
  start_time: "",
  end_time: "",
  expected_attendance: "",
  venue_requirements: "",
  accessibility_needs: "",
  equipment_needs: "",
  other_comments: "",
};

// Declared at module scope, not inside EventRequestForm. A component defined
// during render is a new type on every render, so React would unmount and
// remount the input on each keystroke and the field would lose focus.
function FieldShell({ id, label, hint, error, required, children }) {
  return (
    <>
      <label htmlFor={id}>
        {label}
        {required && <span className="field-required"> (required)</span>}
        {hint && <span className="field-hint">{hint}</span>}
      </label>
      {children}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </>
  );
}

function describedBy(id, error) {
  return error ? `${id}-error` : undefined;
}

function TextField({
  id,
  label,
  hint,
  error,
  required,
  busy,
  value,
  onChange,
  ...rest
}) {
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      <input
        id={id}
        name={id}
        required={required}
        disabled={busy}
        value={value}
        onChange={onChange}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy(id, error)}
        {...rest}
      />
    </FieldShell>
  );
}

function TextAreaField({
  id,
  label,
  error,
  required,
  busy,
  value,
  onChange,
  placeholder,
}) {
  return (
    <FieldShell id={id} label={label} error={error} required={required}>
      <textarea
        id={id}
        name={id}
        required={required}
        rows={3}
        maxLength={EVENT_LIMITS.text}
        placeholder={placeholder}
        disabled={busy}
        value={value}
        onChange={onChange}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy(id, error)}
      />
    </FieldShell>
  );
}

export default function EventRequestForm({ onSubmitted }) {
  const [fields, setFields] = useState(EMPTY);
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setFields((current) => ({ ...current, [field]: value }));
    };
  }

  function errorFor(field) {
    return errors.find((problem) => problem.field === field)?.message ?? "";
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setErrors([]);
    setMessage("");
    try {
      const result = await submitEventRequest(fields);
      if (result.event) {
        setFields(EMPTY);
        onSubmitted(result.event);
        return;
      }
      setErrors(result.errors);
      setMessage(result.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  // Shared props for every control, so a field declaration stays one line of
  // what is actually different about it.
  const wire = (id) => ({
    id,
    busy,
    value: fields[id],
    error: errorFor(id),
    onChange: update(id),
  });

  return (
    <form onSubmit={submit} aria-busy={busy} noValidate>
      <div className="form-section">
        {/* `required` marks what validateForSubmission demands. The form keeps
            noValidate, so the browser doesn't block the send: the server
            returns every missing field at once, shown against each field. */}
        <TextField
          {...wire("name")}
          label="Event name"
          type="text"
          maxLength={EVENT_LIMITS.name}
          placeholder="Annual Partner Summit"
          required
        />
        <TextAreaField
          {...wire("purpose")}
          label="Purpose"
          placeholder="What is this event for?"
          required
        />
        <TextAreaField
          {...wire("description")}
          label="Description"
          placeholder="What will happen on the day?"
          required
        />
      </div>

      <div className="form-section">
        <h2>Schedule</h2>
        <p>The event must start in the future and end after it starts.</p>
        <div className="field-pair">
          <div>
            <TextField
              {...wire("start_time")}
              label="Starts"
              type="datetime-local"
              required
            />
          </div>
          <div>
            <TextField
              {...wire("end_time")}
              label="Ends"
              type="datetime-local"
              required
            />
          </div>
        </div>
        <TextField
          {...wire("expected_attendance")}
          required
          label="Expected attendance"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          placeholder="120"
        />
      </div>

      <div className="form-section">
        <h2>Requirements</h2>
        <p>
          Optional free text. The venue and equipment teams read these later —
          describe what you need in your own words.
        </p>
        <TextAreaField
          {...wire("venue_requirements")}
          label="Venue requirements"
          placeholder="Room layout, location, capacity…"
        />
        <TextAreaField
          {...wire("accessibility_needs")}
          label="Accessibility needs"
          placeholder="Step-free access, hearing loop…"
        />
        <TextAreaField
          {...wire("equipment_needs")}
          label="Equipment needs"
          placeholder="Projector, microphones, staging…"
        />
        <TextAreaField
          {...wire("other_comments")}
          label="Other comments"
          placeholder="Anything else the team should know"
        />
      </div>

      {message ? (
        <p className="error" role="alert">
          {message}
        </p>
      ) : (
        errors.length > 0 && (
          <p className="error" role="alert">
            Check the highlighted {errors.length === 1 ? "field" : "fields"} and
            try again.
          </p>
        )
      )}

      <button className="primary" type="submit" disabled={busy}>
        {busy ? "Submitting…" : "Submit request"}
      </button>
      <p className="card-note">
        Submitting sends your request to ConnectSphere for coordinator
        assignment and review.
      </p>
    </form>
  );
}
