async function requestBody(path, token, options = {}) {
  if (!token) throw new Error("Please sign in to continue.");
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: { ...options.headers, Authorization: "Bearer " + token },
  });
  const body = await response.json();

  if (!response.ok) {
    const detail = Array.isArray(body.details) && body.details.length
      ? ": " + body.details.map((d) => typeof d === "string" ? d : `${d.field} ${d.message}`).join(", ") : "";
    const error = new Error((body.error || body.message || "Request failed") + detail);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function request(path, token, options) {
  return (await requestBody(path, token, options)).data;
}

export function apiFetch(path, token, options = {}) {
  const { body, ...rest } = options;
  return requestBody(path, token, {
    ...rest,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...options.headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

export function fetchEquipmentCatalogue(token) {
  return request("/api/equipment", token);
}

export function fetchEquipmentRequests(eventId, token) {
  return request(`/api/events/${eventId}/equipment-requests`, token);
}

export function createEquipmentRequest(eventId, fields, token) {
  return request(`/api/events/${eventId}/equipment-requests`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fields),
  });
}

// Scrum-28-Scrum63 (AC1): the Technical Support dashboard feed.
export function fetchTechSupportDashboard(token) {
  return request("/api/technical-support/equipment-requests", token);
}

// Scrum-28-Scrum64 (AC2): update an equipment request's status as
// arrangements are made. Same endpoint Scrum-27 used to approve/reject -
// see equipment.controller.js for why no new endpoint was added.
export function updateEquipmentRequestStatus(id, status, token) {
  return request(`/api/equipment-requests/${id}/status`, token, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
}

// Scrum-28-Scrum65/66 (AC3/AC4): the clarification thread for one event,
// aggregated server-side across all of its equipment lines.
export function fetchEventMessages(eventId, token) {
  return request(`/api/events/${eventId}/messages`, token);
}

// equipmentRequestId is required - every message ties to one equipment
// line (the real messages table has it NOT NULL).
export function postEventMessage(eventId, equipmentRequestId, body, token) {
  return request(`/api/events/${eventId}/messages`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ equipment_request_id: equipmentRequestId, body }),
  });
}

export function updateMessage(id, body, token) {
  return request(`/api/messages/${id}`, token, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
}
export function fetchEquipmentEvents(token) {
  return request("/api/equipment/events", token);
}
