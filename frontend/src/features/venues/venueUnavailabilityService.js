// SCRUM-133: API helpers for venue unavailability periods.
import { apiFetch } from "../../lib/api";

export function fetchUnavailabilityPeriods(venueId, token) {
  return apiFetch(`/api/venues/${venueId}/unavailability`, token);
}

export function createUnavailabilityPeriod(venueId, data, token) {
  return apiFetch(`/api/venues/${venueId}/unavailability`, token, { method: "POST", body: data });
}

export function updateUnavailabilityPeriod(venueId, periodId, changes, token) {
  return apiFetch(`/api/venues/${venueId}/unavailability/${periodId}`, token, { method: "PATCH", body: changes });
}

export async function deleteUnavailabilityPeriod(venueId, periodId, token) {
  if (!token) throw new Error("Please sign in to continue.");
  const res = await fetch(`/api/venues/${venueId}/unavailability/${periodId}`, {
    method: "DELETE",
    cache: "no-store",
    headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error || body.message || "Delete failed");
    error.status = res.status;
    throw error;
  }
}
