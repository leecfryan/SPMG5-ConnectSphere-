async function request(path, token, options = {}) {
  if (!token) throw new Error("Please sign in to continue.");
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: { ...options.headers, Authorization: "Bearer " + token },
  });
  const body = await response.json();

  if (!response.ok) {
    const detail = body.details ? `: ${body.details.join(", ")}` : "";
    throw new Error((body.error || body.message || "Request failed") + detail);
  }
  return body.data;
}

export function fetchVenues({ city, minCapacity } = {}, token) {
  const params = new URLSearchParams();
  if (city) params.set("city", city);
  if (minCapacity) params.set("minCapacity", minCapacity);

  const query = params.toString();
  return request(`/api/venues${query ? `?${query}` : ""}`, token);
}

export function fetchVenueById(id, token) {
  return request(`/api/venues/${id}`, token);
}

export function updateVenue(id, changes, token) {
  return request(`/api/venues/${id}`, token, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(changes),
  });
}

// SCRUM-17: availability calendar for one venue.
// Leaving from/to out lets the backend default to a fortnight starting today.
export function fetchVenueAvailability(id, { from, to } = {}, token) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const query = params.toString();
  return request(`/api/venues/${id}/availability${query ? `?${query}` : ""}`, token);
}

// SCRUM-85: events a coordinator can attach a venue request to
export function fetchBookableEvents(token) {
  return request("/api/venues/booking-events", token);
}

export function submitBookingRequest(venueId, payload, token) {
  return request(`/api/venues/${venueId}/booking-requests`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

// SCRUM-88: what Venue Staff review
export function fetchBookingRequests({ status } = {}, token) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request(`/api/venues/booking-requests${query}`, token);
}
