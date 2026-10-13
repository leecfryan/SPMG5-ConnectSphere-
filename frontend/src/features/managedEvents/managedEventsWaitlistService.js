import { apiFetch } from "../../lib/api";

export function fetchCoordinatorWaitlist(eventId, token, { limit = 50, offset = 0 } = {}) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return apiFetch(`/api/managed-events/${eventId}/waitlist?${query}`, token)
    .then((body) => body.waitlist);
}

export function fetchWaitlistAutoOfferSetting(eventId, token) {
  return apiFetch(`/api/managed-events/${eventId}/waitlist/settings`, token)
    .then((body) => body.setting);
}

export function updateWaitlistAutoOfferSetting(eventId, enabled, token) {
  return apiFetch(`/api/managed-events/${eventId}/waitlist/settings`, token, {
    method: "PATCH",
    body: { enabled },
  }).then((body) => body.setting);
}

export function promoteWaitlistEntry(eventId, entryId, token, reason = null) {
  return apiFetch(`/api/managed-events/${eventId}/waitlist/${entryId}/promote`, token, {
    method: "POST",
    body: { reason },
  }).then((body) => body.result);
}
