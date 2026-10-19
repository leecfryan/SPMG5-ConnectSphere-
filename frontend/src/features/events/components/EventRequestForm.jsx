import { useRef, useState } from "react";
import { EVENT_LIMITS, saveDraft, submitDraft, submitEventRequest, updateDraft, updateEventRequest } from "../eventsService";
import {
  registrationEndsAfterEventStarts,
  registrationWindowValidationError,
} from "../registrationWindowFields";
import { useAuth } from "../../auth/useAuth";

// Ownership, assignment and status are server-controlled; the form edits only
// the existing event-detail fields in WRITABLE_COLS.
const EMPTY = {
  name: "",
  purpose: "",
  description: "",
  start_time: "",
  end_time: "",
  registration_start: "",
  registration_end: "",
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

function initialFields(event) {
  if (!event) return EMPTY;
  const fields = Object.fromEntries(Object.keys(EMPTY).map(field => [field, String(event[field] ?? "")]));
  // A saved draft can hold registration times too, so all four are shown in
  // the organiser's local time, the way the datetime-local inputs expect.
  for (const field of ["start_time", "end_time", "registration_start", "registration_end"]) {
    if (!event[field]) continue;
    const date = new Date(event[field]);
    fields[field] = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  }
  return fields;
}

// SCRUM-147: a new request (no `event`) can be saved as a draft at any point;
// `draft` is the saved draft being continued, and onDraftSaved receives each save.
export default function EventRequestForm({ onSubmitted, event: existingEvent, onCancel, draft, onDraftSaved }) {
  const { token } = useAuth();
  const initial = initialFields(existingEvent ?? draft);
  const [fields, setFields] = useState(() => initial);
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState("");
  // false, or which button is working: "draft" or "submit".
  const [pending, setPending] = useState(false);
  const busy = Boolean(pending);
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

  async function send(action, write) {
    submitting.current = true;
    setPending(action);
    setErrors([]);
    setMessage("");
    try {
      const result = await write();
      if (result.event) return result.event;
      setErrors(result.errors);
      setMessage(result.message);
      return null;
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  // AC2: only the name is checked when a draft is saved, so the
  // registration-window check below waits for the submission too.
  async function saveAsDraft() {
    if (submitting.current) return;
    const saved = await send("draft", () => draft ? updateDraft(draft.id, fields, token) : saveDraft(fields, token));
    if (saved) onDraftSaved(saved);
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    const windowError = registrationWindowValidationError(
      fields.registration_start,
      fields.registration_end,
    );
    if (windowError) {
      setErrors([{ field: "registration_end", message: windowError }]);
      setMessage("");
      return;
    }
    const changes = Object.fromEntries(Object.entries(fields).filter(([field, value]) => value !== initial[field]));
    const submitted = await send("submit", () => existingEvent
      ? updateEventRequest(existingEvent.id, changes, token)
      : draft ? submitDraft(draft.id, fields, token) : submitEventRequest(fields, token));
    if (!submitted) return;
    if (!existingEvent) setFields(EMPTY);
    onSubmitted(submitted);
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
        <h2>Registration window</h2>
        <p>Optional. Times use your local timezone and can be independent of the event schedule.</p>
        <div className="field-pair">
          <div>
            <TextField
              {...wire("registration_start")}
              label="Registration opens"
              type="datetime-local"
            />
          </div>
          <div>
            <TextField
              {...wire("registration_end")}
              label="Registration closes"
              type="datetime-local"
            />
          </div>
        </div>
        {registrationEndsAfterEventStarts(fields.registration_end, fields.start_time) && (
          <p className="field-hint">
            Registration closes after the event starts. This is allowed, but attendees may register after the event begins.
          </p>
        )}
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

      <button className="primary" type="submit" disabled={busy || (existingEvent && Object.keys(fields).every(field => fields[field] === initial[field]))}>
        {existingEvent ? (busy ? "Saving…" : "Save changes") : (pending === "submit" ? "Submitting…" : "Submit request")}
      </button>
      {existingEvent && <button className="secondary" type="button" disabled={busy} onClick={onCancel}>Cancel editing</button>}
      {!existingEvent && <button className="secondary" type="button" disabled={busy} onClick={saveAsDraft}>
        {pending === "draft" ? "Saving draft…" : "Save draft"}
      </button>}
      <p className="card-note">
        {existingEvent ? "Saving updates your event details. Your event's status and assignment stay the same." :
          "Submitting sends your request to ConnectSphere for coordinator assignment and review. " +
          "A draft needs only the event name and is visible only to you until you submit it."}
      </p>
    </form>
  );
}
