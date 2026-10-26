// SCRUM-146: API helpers for venue holds.
import { apiFetch } from "../../lib/api";

export function fetchHolds(venueId, token) {
  return apiFetch(`/api/venues/${venueId}/holds`, token);
}

export function createHold(venueId, data, token) {
  return apiFetch(`/api/venues/${venueId}/holds`, token, { method: "POST", body: data });
}

// SCRUM-162: active holds that match the coordinator's event names, ready to convert.
export function fetchEligibleHolds(venueId, token) {
  return apiFetch(`/api/venues/${venueId}/holds/eligible`, token);
}

// SCRUM-162: events with assigned coordinators for the hold placement form.
export function fetchEventsForHolds(token) {
  return apiFetch("/api/venues/events", token);
}
