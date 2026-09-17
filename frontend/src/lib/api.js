const API_BASE_URL = "http://localhost:3000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const body = await response.json();

  if (!response.ok) {
    const detail = body.details ? `: ${body.details.join(", ")}` : "";
    throw new Error((body.error || "Request failed") + detail);
  }
  return body.data;
}

export function fetchVenues({ city, minCapacity } = {}) {
  const params = new URLSearchParams();
  if (city) params.set("city", city);
  if (minCapacity) params.set("minCapacity", minCapacity);

  const query = params.toString();
  return request(`/api/venues${query ? `?${query}` : ""}`);
}

export function fetchVenueById(id) {
  return request(`/api/venues/${id}`);
}

const DEV_ROLE = "Coordinator";

export function updateVenue(id, changes) {
  return request(`/api/venues/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-user-role": DEV_ROLE,
    },
    body: JSON.stringify(changes),
  });
}

// SCRUM-17: availability calendar for one venue.
// Leaving from/to out lets the backend default to a fortnight starting today.
export function fetchVenueAvailability(id, { from, to } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const query = params.toString();
  return request(`/api/venues/${id}/availability${query ? `?${query}` : ""}`);
}

// SCRUM-21: placeholder roles until real sign-in is merged. Named with the
// develop branch role slugs so the backend guard already matches them.
const DEV_REQUESTER_ROLE = "event_coordinator";
const DEV_REVIEWER_ROLE = "venue_staff";

// SCRUM-85: events a coordinator can attach a venue request to
export function fetchBookableEvents() {
  return request("/api/venues/booking-events", {
    headers: { "x-user-role": DEV_REQUESTER_ROLE },
  });
}

export function submitBookingRequest(venueId, payload) {
  return request(`/api/venues/${venueId}/booking-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-role": DEV_REQUESTER_ROLE,
    },
    body: JSON.stringify(payload),
  });
}

// SCRUM-88: what Venue Staff review
export function fetchBookingRequests({ status } = {}) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request(`/api/venues/booking-requests${query}`, {
    headers: { "x-user-role": DEV_REVIEWER_ROLE },
  });
}
