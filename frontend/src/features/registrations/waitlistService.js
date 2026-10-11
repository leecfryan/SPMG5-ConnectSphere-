async function waitlistRequest(eventId, token, method = "GET") {
  if (!token) throw new Error("Please sign in to continue.");
  const response = await fetch(`/api/waitlist/${encodeURIComponent(eventId)}`, {
    method,
    cache: "no-store",
    headers: { Authorization: "Bearer " + token },
  });
  if (response.status === 204) return null;

  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.message || "Unable to process your waitlist request.");
    error.status = response.status;
    throw error;
  }
  return body;
}

export function getWaitlistPosition(eventId, token) {
  return waitlistRequest(eventId, token);
}

export function joinWaitlist(eventId, token) {
  return waitlistRequest(eventId, token, "POST");
}

export function withdrawFromWaitlist(eventId, token) {
  return waitlistRequest(eventId, token, "DELETE");
}
