// SCRUM-139 AC1/AC2: what still stops an event going to the Operational Safety
// Check. Every arrangement counts as essential until SCRUM-144 adds the flag.
//
// Venue: Venue Staff decide a whole request at once, but slots the coordinator
// cancelled stay cancelled, so a request is booked when every slot that is not
// cancelled is confirmed. Fully rejected or cancelled requests are not
// arrangements; the coordinator requests another venue instead.
//
// Equipment: every request must be APPROVED ("Assigned"). REJECTED ("Issues")
// still blocks because Technical Support can revise it. RELEASED is ignored.
// An event with no equipment requests needs no technical arrangements.

const VENUE_PENDING = "Waiting for Venue Staff to decide.";
const NO_VENUE = "No venue booking has been approved yet.";
const EQUIPMENT_REASONS = Object.freeze({
  PENDING: "Waiting for Technical Support Staff to reserve it.",
  REJECTED: "Technical Support Staff reported an issue with this request.",
});

function venueState(request) {
  const live = request.slots.filter((slot) => slot.status !== "cancelled");
  if (live.some((slot) => slot.status === "pending")) return "pending";
  if (live.length > 0 && live.every((slot) => slot.status === "confirmed")) return "booked";
  return "ignored";
}

function findMissingArrangements({ venueRequests, equipmentRequests }) {
  const missing = [];
  let booked = false;

  for (const request of venueRequests) {
    const state = venueState(request);
    if (state === "booked") booked = true;
    if (state === "pending") {
      missing.push({
        kind: "venue",
        label: `${request.venue.name} · ${request.booking_date}`,
        reason: VENUE_PENDING,
      });
    }
  }
  // A pending request already says why the venue is missing.
  if (!booked && missing.length === 0) missing.push({ kind: "venue", label: "Venue", reason: NO_VENUE });

  for (const request of equipmentRequests) {
    const reason = EQUIPMENT_REASONS[request.status];
    if (reason) missing.push({ kind: "equipment", label: request.equipment.type, reason });
  }
  return missing;
}

module.exports = { findMissingArrangements };
