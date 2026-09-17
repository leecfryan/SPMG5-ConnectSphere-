// Field limits are input safeguards that mirror events.validation.js on the
// backend. They shorten the round trip; they are not the rule. The server
// validates every submission regardless of what the browser allowed.
export const EVENT_LIMITS = Object.freeze({ name: 200, text: 2000 });

const TIME_FIELDS = ["start_time", "end_time"];

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// datetime-local gives "2026-09-20T10:00" with no zone. Left as-is, the server
// would read it in *its* time zone (UTC in Docker), shifting the event by the
// organiser's offset. Converted here, where the browser knows the organiser's
// zone. Unreadable values pass through untouched so the server names the field.
function withZonedTimes(fields) {
  const out = { ...fields };
  for (const field of TIME_FIELDS) {
    const millis = new Date(out[field]).getTime();
    if (out[field] && !Number.isNaN(millis)) {
      out[field] = new Date(millis).toISOString();
    }
  }
  return out;
}

// Always resolves to { event, errors, message }:
//   event   - the submitted row on success, otherwise null
//   errors  - [{ field, message }] from the validator, for the fields themselves
//   message - a single message for anything not attributable to a field
export async function submitEventRequest(fields) {
  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withZonedTimes(fields)),
    });
    const payload = await readJson(response);

    if (response.status === 201 && payload?.event) {
      return { event: payload.event, errors: [], message: "" };
    }
    if (response.status === 400 && Array.isArray(payload?.errors)) {
      return { event: null, errors: payload.errors, message: "" };
    }
    return {
      event: null,
      errors: [],
      message:
        payload?.error ||
        "Could not submit the event request. Please try again.",
    };
  } catch {
    return {
      event: null,
      errors: [],
      message: "Unable to connect. Check your connection and try again.",
    };
  }
}
