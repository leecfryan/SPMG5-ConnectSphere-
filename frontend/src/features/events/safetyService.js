import { apiFetch } from "../../lib/api";

// SCRUM-139: the assigned coordinator's safety-check actions. The server takes
// the coordinator from the token and re-checks readiness on submit.
export function submitForSafetyCheck(eventId, token) {
  return apiFetch(`/api/internal/events/${eventId}/submit-safety-check`, token, { method: "POST" })
    .then((body) => body.event);
}

export function withdrawFromSafetyCheck(eventId, token) {
  return apiFetch(`/api/internal/events/${eventId}/withdraw-safety-check`, token, { method: "POST" })
    .then((body) => body.event);
}

// SCRUM-141: a Safety Officer's decision. The server takes the officer from the
// token; the note (optional) or reason (required) is all the browser supplies.
export function approveSafetyArrangement(eventId, note, token) {
  return apiFetch(`/api/internal/safety-reviews/${eventId}/approve`, token, { method: "POST", body: { note } })
    .then((body) => body.event);
}

export function rejectSafetyArrangement(eventId, reason, token) {
  return apiFetch(`/api/internal/safety-reviews/${eventId}/reject`, token, { method: "POST", body: { reason } })
    .then((body) => body.event);
}

// SCRUM-144: the assigned coordinator confirms the event; the server re-checks
// that nothing essential is outstanding.
export function confirmEvent(eventId, token) {
  return apiFetch(`/api/internal/events/${eventId}/confirm`, token, { method: "POST" })
    .then((body) => body.event);
}

// SCRUM-144 AC4: the coordinator marks one venue or equipment request essential or not.
export function setArrangementEssential(eventId, kind, requestId, isEssential, token) {
  return apiFetch(`/api/internal/events/${eventId}/arrangements/${kind}/${requestId}`, token, {
    method: "PATCH", body: { is_essential: isEssential },
  }).then((body) => body.arrangement);
}
