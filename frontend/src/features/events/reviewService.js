import { apiFetch } from "../../lib/api";

// SCRUM-98/99: the assigned coordinator's review actions. The server takes the
// reviewer from the token; the note is the only thing the browser supplies.
export function startReview(eventId, token) {
  return apiFetch(`/api/internal/events/${eventId}/start-review`, token, { method: "POST" })
    .then((body) => body.event);
}

export function approveEvent(eventId, note, token) {
  return apiFetch(`/api/internal/events/${eventId}/approve`, token, { method: "POST", body: { note } })
    .then((body) => body.event);
}

export function rejectEvent(eventId, note, token) {
  return apiFetch(`/api/internal/events/${eventId}/reject`, token, { method: "POST", body: { note } })
    .then((body) => body.event);
}
