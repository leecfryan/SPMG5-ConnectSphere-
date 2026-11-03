// SCRUM-38: a venue booking flagged as no longer fitting its event (affected)
// that has not yet been released or replaced still needs the coordinator.
export function needsAttention(request) {
  return request.is_affected === true && request.status !== "cancelled";
}

// The server prefixes its own re-check reasons (venueRevalidation.js); on the
// event page the heading already says the event changed, so it is not repeated.
const RECHECK_PREFIX = "After the event changed: ";

export function displayReason(reason) {
  if (!reason) return "Flagged as no longer suitable for this event.";
  return reason.startsWith(RECHECK_PREFIX) ? reason.slice(RECHECK_PREFIX.length) : reason;
}
