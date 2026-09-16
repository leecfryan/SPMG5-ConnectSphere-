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
