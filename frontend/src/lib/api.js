const API_BASE_URL = "http://localhost:3000";

async function request(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || "Request failed");
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