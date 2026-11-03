const { venueState } = require("./safetyReadiness");
const { readNote } = require("./review.service");

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

  // SCRUM-141 AC4: the status moves first, so a lost race (409) writes no
  // history. If the history row then fails, the move is undone: a decision
  // never stands unrecorded. No coordinator filter: any officer may decide.
  async function decide(eventId, officerId, to, action, note) {
    const moved = await repository.transitionStatus(eventId, "SAFETY_REVIEW", to);
    if (!moved) {
      const existing = await repository.findById(eventId);
      return { ok: false, reason: existing ? "conflict" : "not_found" };
    }
    try {
      await repository.recordActivity({ eventId, actorId: officerId, action, fromStatus: "SAFETY_REVIEW", toStatus: to, note });
    } catch (error) {
      await repository.undoTransition(eventId, "SAFETY_REVIEW", to);
      throw error;
    }
    // Only id and status go back: the officer sees no organiser or coordinator details (#45).
    return { ok: true, event: { id: moved.id, status: moved.status } };
  }

  // SCRUM-141 AC1/AC3: approval is the only way into PREPARATION.
  async function approve(eventId, officerId, note) {
    const parsed = readNote(note);
    if (!parsed.ok) return { ok: false, reason: "invalid_note" };
    return decide(eventId, officerId, "PREPARATION", "SAFETY_APPROVED", parsed.note);
  }

  // SCRUM-141 AC2/AC3: a rejection needs a reason and returns the event to
  // planning (APPROVED), where the coordinator can fix it and resubmit.
  async function reject(eventId, officerId, reason) {
    const parsed = readNote(reason);
    if (!parsed.ok || parsed.note === null) return { ok: false, reason: "reason_required" };
    return decide(eventId, officerId, "APPROVED", "SAFETY_REJECTED", parsed.note);
  }

  return { list, detail, approve, reject };
}

module.exports = { createSafetyReviewService };
