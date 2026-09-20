import { useState } from "react";

export default function RegistrationForm({ fields = [], onSubmit, busy, disabled }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.id, ""]))
  );

  function handleChange(id, value) {
    setValues((prev) => ({ ...prev, [id]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (busy || disabled) return;
    const data = Object.fromEntries(
      fields.map((f) => [f.id, values[f.id]?.trim() || null])
    );
    onSubmit(data);
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={busy}>
      {fields.map((field) => (
        <div key={field.id}>
          <label htmlFor={`reg-${field.id}`}>
            {field.label}
          </label>
          <input
            id={`reg-${field.id}`}
            type={field.type ?? "text"}
            required={field.required}
            maxLength={500}
            disabled={busy || disabled}
            value={values[field.id] ?? ""}
            onChange={(e) => handleChange(field.id, e.target.value)}
          />
        </div>
      ))}
      <button className="primary" type="submit" disabled={busy || disabled}>
        {busy ? "Registering…" : "Register for this event"}
      </button>
    </form>
  );
}
