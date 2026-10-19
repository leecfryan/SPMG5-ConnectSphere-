// SCRUM-135: API helper for venue booking conflict flags.
import { apiFetch } from "../../lib/api";

export function fetchConflictFlags(venueId, token) {
  return apiFetch(`/api/venues/${venueId}/booking-conflicts`, token);
}
