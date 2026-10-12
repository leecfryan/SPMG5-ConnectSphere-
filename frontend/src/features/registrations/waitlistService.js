async function waitlistRequest(eventId, token, method = "GET", path = "", requestBody) {
  if (!token) throw new Error("Please sign in to continue.");
  const response = await fetch(`/api/waitlist/${encodeURIComponent(eventId)}${path}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + token,
      ...(requestBody ? { "Content-Type": "application/json" } : {}),
    },
    ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
  });
  if (response.status === 204) return null;

  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.message || "Unable to process your waitlist request.");
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}

export function getWaitlistPosition(eventId, token) {
  return waitlistRequest(eventId, token, "GET", "/state");
}

export function joinWaitlist(eventId, token, registrationData) {
  return waitlistRequest(eventId, token, "POST", "", { registrationData });
}

export function withdrawFromWaitlist(eventId, token) {
  return waitlistRequest(eventId, token, "DELETE");
}

export function updateWaitlistDetails(eventId, token, registrationData) {
  return waitlistRequest(eventId, token, "PUT", "/details", { registrationData });
}

export function acceptWaitlistOffer(eventId, token) {
  return waitlistRequest(eventId, token, "POST", "/offer/accept");
}

export function declineWaitlistOffer(eventId, token) {
  return waitlistRequest(eventId, token, "POST", "/offer/decline");
}
