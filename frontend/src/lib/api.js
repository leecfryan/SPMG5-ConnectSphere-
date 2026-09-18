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

// Unlike every other function here, /api/auth/me replies with { user }, not
// { data } (see App.jsx's Account component, which reads response.json().user
// the same way) - so this bypasses the shared request() helper rather than
// getting back undefined from body.data.
export async function fetchCurrentUser(token) {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!response.ok) {
    const error = new Error("Unable to verify your session.");
    error.status = response.status;
    throw error;
  }
  return (await response.json()).user;
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

// Scrum-28-Scrum63 (AC1): the Technical Support dashboard feed.
export function fetchTechSupportDashboard(token) {
  return request("/api/technical-support/equipment-requests", {
    headers: { Authorization: "Bearer " + token },
  });
}

// Scrum-28-Scrum64 (AC2): update an equipment request's status as
// arrangements are made. Same endpoint Scrum-27 used to approve/reject -
// see equipment.controller.js for why no new endpoint was added.
export function updateEquipmentRequestStatus(id, status, token) {
  return request(`/api/equipment-requests/${id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ status }),
  });
}

// Scrum-28-Scrum65/66 (AC3/AC4): the clarification thread for one event,
// aggregated server-side across all of its equipment lines.
export function fetchEventMessages(eventId, token) {
  return request(`/api/events/${eventId}/messages`, {
    headers: { Authorization: "Bearer " + token },
  });
}

// equipmentRequestId is required - every message ties to one equipment
// line (the real messages table has it NOT NULL).
export function postEventMessage(eventId, equipmentRequestId, body, token) {
  return request(`/api/events/${eventId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ equipment_request_id: equipmentRequestId, body }),
  });
}

export function updateMessage(id, body, token) {
  return request(`/api/messages/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ body }),
  });
}