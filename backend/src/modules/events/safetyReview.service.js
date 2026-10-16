const { venueState } = require("./safetyReadiness");

// SCRUM-140 AC3: only arrangements already confirmed are shown, using the same
// meaning as the SCRUM-139 readiness check, so the Safety Officer reviews
// exactly what let the event through.
//
// SCRUM-140 AC2 has no dedicated columns (decided 2026-10-14, no schema
// change): crowd movement is the organiser's comments, emergency access and
// restrictions are the venue's notes, and equipment placement is each
// reserved item's technical requirement.
function toVenue(request) {
  return {
    id: request.id,
    name: request.venue.name,
    booking_date: request.booking_date,
    slots: request.slots.filter((slot) => slot.status === "confirmed").map((slot) => slot.slot),
    expected_attendees: request.expected_attendees,
    capacity: request.venue.capacity,
    room_layout: request.room_layout,
    accessibility_requirements: request.accessibility_requirements,
    accessibility_features: request.venue.accessibility_features,
    notes: request.venue.notes,
  };
}

function toEquipment(request) {
  return {
    id: request.id,
    type: request.equipment.type,
    quantity_requested: request.quantity_requested,
    technical_requirement: request.technical_requirement,
  };
}

function createSafetyReviewService({ repository }) {
  async function list() {
    return repository.findAwaitingSafetyReview();
  }

  async function detail(eventId) {
    const event = await repository.findAwaitingSafetyReviewById(eventId);
    if (!event) return { ok: false, reason: "not_found" };

    const { venueRequests, equipmentRequests } = await repository.findArrangements(eventId);
    return {
      ok: true,
      event,
      venues: venueRequests.filter((request) => venueState(request) === "booked").map(toVenue),
      equipment: equipmentRequests.filter((request) => request.status === "APPROVED").map(toEquipment),
    };
  }

  return { list, detail };
}

module.exports = { createSafetyReviewService };
