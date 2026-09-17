const API_BASE_URL = "http://localhost:3000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const body = await response.json();

  if (!response.ok) {
    // Validation details come as plain strings (venues) or { field, message }
    // objects (events/equipment) depending on the feature - handle both.
    const detail =
      Array.isArray(body.details) && body.details.length > 0
        ? ": " +
          body.details
            .map((d) => (typeof d === "string" ? d : `${d.field} ${d.message}`))
            .join(", ")
        : "";
    // Auth/role middleware replies with { message }; feature controllers
    // reply with { error }. Read either so the caller always gets real text.
    const error = new Error((body.error || body.message || "Request failed") + detail);
    error.status = response.status;
    throw error;
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

export function fetchEquipmentCatalogue(token) {
  return request("/api/equipment", {
    headers: { Authorization: "Bearer " + token },
  });
}

export function fetchEquipmentRequests(eventId, token) {
  return request(`/api/events/${eventId}/equipment-requests`, {
    headers: { Authorization: "Bearer " + token },
  });
}

export function createEquipmentRequest(eventId, fields, token) {
  return request(`/api/events/${eventId}/equipment-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(fields),
  });
}