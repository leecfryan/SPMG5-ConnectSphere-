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

// Every equipment endpoint requires real Supabase auth (see
// backend/src/routes/equipment.routes.js), unlike updateVenue's x-user-role
// dev stub above - all of these need the signed-in user's session token.
function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export function fetchEquipmentTypes(token) {
  return request(`/api/equipment-types`, { headers: authHeaders(token) });
}

export function fetchEquipmentRequests(eventId, token) {
  return request(`/api/events/${eventId}/equipment-requests`, {
    headers: authHeaders(token),
  });
}

export function createEquipmentRequest(eventId, fields, token) {
  return request(`/api/events/${eventId}/equipment-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(fields),
  });
}