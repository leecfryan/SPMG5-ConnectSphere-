// A missing note is null; anything other than text is refused.
function readNote(note) {
  if (note === undefined || note === null) return { ok: true, note: null };
  if (typeof note !== "string") return { ok: false };
  return { ok: true, note: note.trim() || null };
}

function createReviewService({ repository }) {
  async function move(eventId, coordinatorId, from, to, extra = {}) {
    const event = await repository.transitionStatus(eventId, from, to, extra, coordinatorId);
    if (event) return { ok: true, event };

    const existing = await repository.findById(eventId);
    return { ok: false, reason: existing ? "conflict" : "not_found" };
  }

  // SCRUM-98 AC3: the decision records who made it and when. approved_rejected_by is kept
  // apart from coordinator_id so a later reassignment can't rewrite it (#94).
  function outcome(coordinatorId, note) {
    return { approved_rejected_by: coordinatorId, approved_rejected_at: new Date().toISOString(), approval_rejection_remark: note };
  }

  // SCRUM-98 AC2: review begins on the coordinator's own action; assignment
  // alone leaves the event SUBMITTED (discussion #95).
  async function startReview(eventId, coordinatorId) {
    return move(eventId, coordinatorId, "SUBMITTED", "UNDER_REVIEW");
  }

  // SCRUM-99 AC2: approval writes the decision only. It books no venue,
  // equipment, technical support or registration arrangement (discussion #80).
  async function approve(eventId, coordinatorId, note) {
    const parsed = readNote(note);
    if (!parsed.ok) return { ok: false, reason: "invalid_note" };
    return move(eventId, coordinatorId, "UNDER_REVIEW", "APPROVED", outcome(coordinatorId, parsed.note));
  }

  async function reject(eventId, coordinatorId, note) {
    const parsed = readNote(note);
    if (!parsed.ok || parsed.note === null) return { ok: false, reason: "note_required" };
    return move(eventId, coordinatorId, "UNDER_REVIEW", "REJECTED", outcome(coordinatorId, parsed.note));
  }

  // SCRUM-148 AC1/AC2: the assigned coordinator or the ops manager may cancel
  // at any of the four active stages, with a required reason. Unlike move(),
  // cancel has no single `from` status, so it uses repository.cancel instead
  // of transitionStatus - see events.repository.js. isOpsManager means no
  // coordinator_id filter is added to the write (an ops manager may cancel
  // any event); otherwise the write is guarded to the coordinator still
  // holding the event, same race-guard shape as move().
  //
  // AC3: release what the event was holding. Equipment is in-lane; venue
  // release is an optional, owner-approved seam (see the task note's
  // Decisions). Both run synchronously here so AC3 is true the moment
  // cancellation is saved, not only on a later equipment read.
  async function cancel(eventId, actorId, reason, { isOpsManager = false, equipmentService, releaseVenueBookingsForCancelledEvent } = {}) {
    const parsed = readNote(reason);
    if (!parsed.ok || parsed.note === null) return { ok: false, reason: "reason_required" };

    const extra = {
      cancelled_by: actorId,
      cancelled_at: new Date().toISOString(),
      cancellation_reason: parsed.note,
    };
    const event = await repository.cancel(eventId, extra, isOpsManager ? undefined : actorId);
    if (!event) {
      const existing = await repository.findById(eventId);
      return { ok: false, reason: existing ? "conflict" : "not_found" };
    }

    await equipmentService?.releaseReservationsForCancelledEvent?.(eventId, actorId);
    await releaseVenueBookingsForCancelledEvent?.(eventId);

    return { ok: true, event };
  }

  return { startReview, approve, reject, cancel };
}

module.exports = { createReviewService };
