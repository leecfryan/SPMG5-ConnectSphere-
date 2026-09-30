import { apiFetch } from "../../lib/api";

export function fetchManagedEvents(token) {
  return apiFetch("/api/managed-events", token).then((body) => body.events);
}

export function fetchEventRegistrationSummary(eventId, token) {
  return apiFetch(`/api/managed-events/${eventId}`, token).then((body) => body.summary);
}
