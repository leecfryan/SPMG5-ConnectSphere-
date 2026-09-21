import { apiFetch } from "../../lib/api";

export function fetchAssignmentQueue(token) {
  return apiFetch("/api/internal/events/unassigned", token).then((body) => body.events);
}

export function fetchCoordinators(token) {
  return apiFetch("/api/internal/coordinators", token).then((body) => body.coordinators);
}

export function assignCoordinator(eventId, coordinatorId, token) {
  return apiFetch(`/api/internal/events/${eventId}/coordinator`, token, {
    method: "PUT",
    body: { coordinatorId },
  }).then((body) => body.event);
}
