import { apiFetch } from "../../lib/api";

// Field limits are input safeguards that mirror events.validation.js on the
// backend. They shorten the round trip; they are not the rule. The server
// validates every submission regardless of what the browser allowed.
export const EVENT_LIMITS = Object.freeze({ name: 200, text: 2000 });

const TIME_FIELDS = ["start_time", "end_time", "registration_start", "registration_end"];

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
export function withZonedTimes(fields) {
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
export async function submitEventRequest(fields, token) {
  if (!token) return { event: null, errors: [], message: "Please sign in to submit an event request." };
  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
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
        payload?.error || payload?.message ||
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

// Same { event, errors, message } shape as submitEventRequest, for the
// apiFetch-based writes.
async function sendEventFields(path, method, fields, token, { signedOut, malformed }) {
  if (!token) return { event: null, errors: [], message: signedOut };
  try {
    const payload = await apiFetch(path, token, { method, body: withZonedTimes(fields) });
    if (!payload.event) return { event: null, errors: [], message: malformed };
    return { event: payload.event, errors: [], message: "" };
  } catch (error) {
    return {
      event: null, errors: error.errors || [],
      message: error.errors?.length ? "" : error.status ? error.message : "Unable to connect. Check your connection and try again.",
    };
  }
}

export function updateEventRequest(eventId, fields, token) {
  return sendEventFields(`/api/event-workspace/organiser/${encodeURIComponent(eventId)}`, "PATCH", fields, token, {
    signedOut: "Please sign in to update an event.",
    malformed: "Unable to update the event. Please refresh and try again.",
  });
}

// SCRUM-147: drafts. The whole form is sent each time, so a field the
// organiser cleared is cleared on the draft too.
const DRAFT_MESSAGES = Object.freeze({
  signedOut: "Please sign in to save a draft.",
  malformed: "Unable to save the draft. Please refresh and try again.",
});
const draftPath = (draftId = "") => `/api/events/drafts${draftId && "/" + encodeURIComponent(draftId)}`;

export function saveDraft(fields, token) {
  return sendEventFields(draftPath(), "POST", fields, token, DRAFT_MESSAGES);
}

export function updateDraft(draftId, fields, token) {
  return sendEventFields(draftPath(draftId), "PATCH", fields, token, DRAFT_MESSAGES);
}

export function submitDraft(draftId, fields, token) {
  return sendEventFields(`${draftPath(draftId)}/submit`, "POST", fields, token, {
    signedOut: "Please sign in to submit an event request.",
    malformed: "Could not submit the event request. Please try again.",
  });
}
