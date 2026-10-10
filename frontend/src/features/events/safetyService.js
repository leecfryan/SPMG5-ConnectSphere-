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
