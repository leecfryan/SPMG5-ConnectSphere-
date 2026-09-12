// Field limits are input safeguards that mirror events.validation.js on the
// backend. They shorten the round trip; they are not the rule. The server
// validates every submission regardless of what the browser allowed.
export const EVENT_LIMITS = Object.freeze({ name: 200, text: 2000 });

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// Always resolves to { event, errors, message }:
//   event   - the created row on success, otherwise null
//   errors  - [{ field, message }] from the validator, for the fields themselves
//   message - a single message for anything not attributable to a field
export async function createEventRequest(fields) {
  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
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
        "Could not save the event request. Please try again.",
    };
  } catch {
    return {
      event: null,
      errors: [],
      message: "Unable to connect. Check your connection and try again.",
    };
  }
}
