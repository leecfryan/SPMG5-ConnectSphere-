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

// SCRUM-148: the assigned coordinator or the coordinator lead cancels, with a required reason.
export function cancelEvent(eventId, reason, token) {
  return apiFetch(`/api/internal/events/${eventId}/cancel`, token, { method: "POST", body: { reason } })
    .then((body) => body.event);
}

// SCRUM-149/170: a required reason and an optional new start and end. With a
// new date the server also reports which venues moved and which were released.
export function postponeEvent(eventId, reason, token, { newStart, newEnd } = {}) {
  const body = newStart || newEnd ? { reason, new_start_time: newStart, new_end_time: newEnd } : { reason };
  return apiFetch(`/api/internal/events/${eventId}/postpone`, token, { method: "POST", body })
    .then((result) => ({ event: result.event, venueRecheck: result.venue_recheck ?? null }));
}

export function requestEventChanges(eventId, note, token) {
  return apiFetch(`/api/internal/events/${eventId}/request-changes`, token, { method: "POST", body: { note } })
    .then((body) => body.event);
}

// SCRUM-165: coordinator approves or rejects a pending change request.
export function decideChangeRequest(eventId, decision, reason, token) {
  return apiFetch(`/api/internal/events/${eventId}/decide-change-request`, token, {
    method: "POST",
    body: { decision, reason },
  // SCRUM-38: the venue re-check summary comes back with the decision.
  }).then((body) => ({ event: body.event, venueRecheck: body.venue_recheck ?? null }));
}
