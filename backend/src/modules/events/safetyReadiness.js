// SCRUM-139 AC1/AC2: what still stops an event going to the Operational Safety
// Check, and SCRUM-144 AC1-AC3: what still stops it being confirmed. One rule
// for both, so the two gates never disagree.
//
// SCRUM-144 AC4: an outstanding request its coordinator marked non-essential
// (is_essential false; #106, #80) does not block; it is listed as optional.
// A booked venue is still required whatever the flags say.
//
// Venue: Venue Staff decide a whole request at once, but slots the coordinator
// cancelled stay cancelled, so a request is booked when every slot that is not
// cancelled is confirmed. Fully rejected or cancelled requests are not
// arrangements; the coordinator requests another venue instead.
//
// Equipment: every request must be APPROVED ("Assigned"). REJECTED ("Issues")
// still blocks because Technical Support can revise it. RELEASED is ignored.
// An event with no equipment requests needs no technical arrangements.
//
// SCRUM-150: REVIEW_REQUIRED also blocks - a reservation flagged for
// re-review after a reschedule is exactly as unsettled as a PENDING one, and
// this gate must not disagree with hasUnresolvedEquipment's own policy
// (equipment.service.js) about the same equipment_requests data.

const VENUE_PENDING = "Waiting for Venue Staff to decide.";
const NO_VENUE = "No venue booking has been approved yet.";
const EQUIPMENT_REASONS = Object.freeze({
  PENDING: "Waiting for Technical Support Staff to reserve it.",
  REJECTED: "Technical Support Staff reported an issue with this request.",
  REVIEW_REQUIRED: "This reservation needs to be reviewed again after the event was rescheduled.",
});

function venueState(request) {
  const live = request.slots.filter((slot) => slot.status !== "cancelled");
  if (live.some((slot) => slot.status === "pending")) return "pending";
  if (live.length > 0 && live.every((slot) => slot.status === "confirmed")) return "booked";
  return "ignored";
}

function checkArrangements({ venueRequests, equipmentRequests }) {
  const missing = [];
  const optional = [];
  // id lets the coordinator mark the request essential or not (SCRUM-144 AC4).
  const outstanding = (request, item) => (request.is_essential === false ? optional : missing).push({ ...item, id: request.id });
  let booked = false;

  for (const request of venueRequests) {
    const state = venueState(request);
    if (state === "booked") booked = true;
    if (state === "pending") {
      outstanding(request, { kind: "venue", label: `${request.venue.name} · ${request.booking_date}`, reason: VENUE_PENDING });
    }
  }
  // A pending essential request already says why the venue is missing.
  if (!booked && missing.length === 0) missing.push({ kind: "venue", label: "Venue", reason: NO_VENUE });

  for (const request of equipmentRequests) {
    const reason = EQUIPMENT_REASONS[request.status];
    // SCRUM-31: equipment_id is now nullable (a request can exist before a
    // unit is assigned), so the embedded equipment join can be null - read
    // the request's own equipment_type first, same value either way.
    if (reason) outstanding(request, { kind: "equipment", label: request.equipment_type ?? request.equipment?.type ?? null, reason });
  }
  return { missing, optional };
}

const findMissingArrangements = (arrangements) => checkArrangements(arrangements).missing;

module.exports = { checkArrangements, findMissingArrangements, venueState };
