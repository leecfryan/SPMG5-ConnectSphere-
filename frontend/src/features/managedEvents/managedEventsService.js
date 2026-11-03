import { apiFetch } from "../../lib/api";
import { withZonedTimes } from "../events/eventsService";

export function fetchManagedEvents(token) {
  return apiFetch("/api/managed-events", token).then((body) => body.events);
}

export function fetchEventRegistrationSummary(eventId, token) {
  return apiFetch(`/api/managed-events/${eventId}`, token).then((body) => body.summary);
}

export function fetchManagedRegistrationWindow(eventId, token) {
  return apiFetch(`/api/managed-events/${eventId}/registration-window`, token).then((body) => ({
    ...body.window,
    server_time: body.server_time,
    server_time_received_at: Date.now(),
  }));
}

export function updateRegistrationWindow(eventId, fields, token) {
  return apiFetch(`/api/managed-events/${eventId}/registration-window`, token, {
    method: "PATCH",
    body: withZonedTimes(fields),
  }).then((body) => ({
    ...body.event,
    server_time: body.server_time,
    server_time_received_at: Date.now(),
  }));
}
