// SCRUM-146: API helpers for venue holds.
import { apiFetch } from "../../lib/api";

export function fetchHolds(venueId, token) {
  return apiFetch(`/api/venues/${venueId}/holds`, token);
}

export function createHold(venueId, data, token) {
  return apiFetch(`/api/venues/${venueId}/holds`, token, { method: "POST", body: data });
}
