import { useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { submitChangeRequest, withZonedTimes, EVENT_LIMITS } from "../eventsService";

// SCRUM-36: change requests are accepted for events under active review or
// in planning. Mirrors ELIGIBLE_CHANGE_REQUEST_STATUSES in the service.
const ELIGIBLE_STATUSES = ["UNDER_REVIEW", "APPROVED"];

const FIELD_DEFS = [
  { key: "name",                label: "Event name",          type: "text" },
  { key: "purpose",             label: "Purpose",             type: "textarea" },
  { key: "description",         label: "Description",         type: "textarea" },
  { key: "start_time",          label: "Start",               type: "datetime" },
  { key: "end_time",            label: "End",                 type: "datetime" },
  { key: "registration_start",  label: "Registration opens",  type: "datetime" },
  { key: "registration_end",    label: "Registration closes", type: "datetime" },
  { key: "expected_attendance", label: "Expected attendance", type: "number" },
  { key: "venue_requirements",  label: "Venue requirements",  type: "textarea" },
  { key: "accessibility_needs", label: "Accessibility needs", type: "textarea" },
  { key: "equipment_needs",     label: "Equipment needs",     type: "textarea" },
  { key: "other_comments",      label: "Other comments",      type: "textarea" },
];

function toDatetimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

function initialState(event) {
  const state = {};
  for (const { key, type } of FIELD_DEFS) {
    state[key] = type === "datetime" ? toDatetimeLocal(event[key]) : String(event[key] ?? "");
  }
  return state;
}

export default function ChangeRequestControls({ event, onSubmitted }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState("");

  // AC6: always show a stored pending request, even if the status has since
  // moved past ELIGIBLE_STATUSES (e.g. UNDER_REVIEW → SAFETY_REVIEW after
  // the coordinator started the next stage). Checking this before the gate
  // means a request submitted while APPROVED remains visible to the organiser.
  if (event.pending_change_request) {
    const { proposed_changes, reason: req_reason, requested_at } = event.pending_change_request;
    const changedDefs = FIELD_DEFS.filter(({ key }) => Object.hasOwn(proposed_changes, key));
    return (
      <section aria-labelledby="cr-heading">
        <h2 id="cr-heading">Change request</h2>
        <p>Status: Awaiting review</p>
        <p>Submitted: {new Date(requested_at).toLocaleString()}</p>
        <p>Reason: {req_reason}</p>
        {changedDefs.length > 0 && (
          <dl>
            {changedDefs.map(({ key, label }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{proposed_changes[key] ?? "Not provided"}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    );
  }

  if (!ELIGIBLE_STATUSES.includes(event.status)) return null;

  if (!open) {
    return (
      <section>
        <button
          type="button"
          onClick={() => { setFields(initialState(event)); setErrors([]); setMessage(""); setReason(""); setOpen(true); }}
        >
          Request a change
        </button>
      </section>
    );
  }

  const errFor = (field) => errors.find(e => e.field === field)?.message;
  const onChange = (key) => (e) => setFields(prev => ({ ...prev, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors([]);
    setMessage("");

    // Build diff: only fields whose value differs from the initial state.
    const initial = initialState(event);
    const proposed = {};
    for (const { key, type } of FIELD_DEFS) {
      const next = fields[key] ?? "";
      if (next === (initial[key] ?? "")) continue;
      if (type === "datetime" || type === "textarea" || type === "text") {
        proposed[key] = next || null;
      } else {
        proposed[key] = next ? Number(next) : null;
      }
    }

    if (Object.keys(proposed).length === 0) {
      setErrors([{ field: "proposed_changes", message: "Change at least one field before submitting." }]);
      return;
    }

    setBusy(true);
    const { event: updated, errors: fieldErrors, message: msg } = await submitChangeRequest(
      event.id,
      { proposed_changes: withZonedTimes(proposed), reason },
      token,
    );
    setBusy(false);
    if (updated) { onSubmitted(); return; }
    setErrors(fieldErrors || []);
    setMessage(msg || "");
  }

  return (
    <section aria-labelledby="cr-heading">
      <h2 id="cr-heading">Request a change</h2>
      <p>Propose changes to one or more fields. The coordinator will review your request before any changes are applied to the event.</p>
      {message && <p role="alert">{message}</p>}
      {errFor("proposed_changes") && <p role="alert">{errFor("proposed_changes")}</p>}
      <form onSubmit={handleSubmit}>
        {FIELD_DEFS.map(({ key, label, type }) => (
          <div key={key}>
            <label htmlFor={"cr-" + key}>{label}</label>
            {type === "textarea" ? (
              <textarea id={"cr-" + key} value={fields[key] ?? ""} onChange={onChange(key)} maxLength={EVENT_LIMITS.text} rows={3} />
            ) : type === "datetime" ? (
              <input id={"cr-" + key} type="datetime-local" value={fields[key] ?? ""} onChange={onChange(key)} />
            ) : type === "number" ? (
              <input id={"cr-" + key} type="number" value={fields[key] ?? ""} onChange={onChange(key)} min={1} />
            ) : (
              <input id={"cr-" + key} type="text" value={fields[key] ?? ""} onChange={onChange(key)} maxLength={EVENT_LIMITS.name} />
            )}
            {errFor(key) && <p role="alert" id={"cr-err-" + key}>{errFor(key)}</p>}
          </div>
        ))}
        <div>
          <label htmlFor="cr-reason">Reason for change</label>
          <textarea id="cr-reason" value={reason} onChange={e => setReason(e.target.value)} required rows={3} />
          {errFor("reason") && <p role="alert">{errFor("reason")}</p>}
        </div>
        <button type="submit" disabled={busy}>{busy ? "Submitting..." : "Submit change request"}</button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </form>
    </section>
  );
}
