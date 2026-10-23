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

  // SCRUM-99 AC2: approval writes the decision only, for a first-time review.
  // SCRUM-37 team design: for a resubmission (an event apply_organiser_event_edit
  // sent back to SUBMITTED), approving releases whatever arrangements it had -
  // the coordinator re-requests fresh ones rather than the same reservation
  // being re-reviewed by Technical Support/Venue Staff. Both release calls are
  // already no-ops when nothing is live, so this is safe on an ordinary
  // first-time approval too (discussion #80: approval itself still books
  // nothing new; it only ever releases what a significant edit had flagged
  // as stale).
  async function approve(eventId, coordinatorId, note, { equipmentService, releaseVenueBookingsForCancelledEvent } = {}) {
    const parsed = readNote(note);
    if (!parsed.ok) return { ok: false, reason: "invalid_note" };
    const result = await move(eventId, coordinatorId, "UNDER_REVIEW", "APPROVED", outcome(coordinatorId, parsed.note));
    if (!result.ok) return result;

    await equipmentService?.releaseReservationsForEvent?.(eventId, coordinatorId);
    await releaseVenueBookingsForCancelledEvent?.(eventId);

    return result;
  }

  // SCRUM-37 team design: rejecting a resubmission (an event sent back to
  // SUBMITTED by a significant edit, then returned here via startReview) must
  // also release whatever arrangements it had - same two release functions
  // cancel()/postpone()/approve() already call, reused as-is. Both are
  // already no-ops when nothing is live, so this is safe on an ordinary
  // first-time rejection too (nothing has ever been arranged yet at that
  // point, since arrangements only exist from APPROVED onward).
  async function reject(eventId, coordinatorId, note, { equipmentService, releaseVenueBookingsForCancelledEvent } = {}) {
    const parsed = readNote(note);
    if (!parsed.ok || parsed.note === null) return { ok: false, reason: "note_required" };
    const result = await move(eventId, coordinatorId, "UNDER_REVIEW", "REJECTED", outcome(coordinatorId, parsed.note));
    if (!result.ok) return result;

    await equipmentService?.releaseReservationsForEvent?.(eventId, coordinatorId);
    await releaseVenueBookingsForCancelledEvent?.(eventId);

    return result;
  }

  // SCRUM-148 AC1/AC2: the assigned coordinator or the coordinator lead may cancel
  // at any active stage, including POSTPONED, with a required reason. Unlike move(),
  // cancel has no single `from` status, so it uses repository.cancel instead
  // of transitionStatus - see events.repository.js. isCoordinatorLead means no
  // coordinator_id filter is added to the write (a coordinator lead may cancel
  // any event); otherwise the write is guarded to the coordinator still
  // holding the event, same race-guard shape as move().
  //
  // AC3: release what the event was holding. Equipment is in-lane; venue
  // release is an optional, owner-approved seam (see the task note's
  // Decisions). Both run synchronously here so AC3 is true the moment
  // cancellation is saved, not only on a later equipment read.
  async function cancel(eventId, actorId, reason, { isCoordinatorLead = false, equipmentService, releaseVenueBookingsForCancelledEvent } = {}) {
    const parsed = readNote(reason);
    if (!parsed.ok || parsed.note === null) return { ok: false, reason: "reason_required" };

    const extra = {
      cancelled_by: actorId,
      cancelled_at: new Date().toISOString(),
      cancellation_reason: parsed.note,
    };
    const event = await repository.cancel(eventId, extra, isCoordinatorLead ? undefined : actorId);
    if (!event) {
      const existing = await repository.findById(eventId);
      return { ok: false, reason: existing ? "conflict" : "not_found" };
    }

    await equipmentService?.releaseReservationsForEvent?.(eventId, actorId);
    await releaseVenueBookingsForCancelledEvent?.(eventId);

    return { ok: true, event };
  }

  // SCRUM-149 AC1/AC3: same shape as cancel() - the assigned coordinator or
  // the coordinator lead, a required reason, gated on repository.postpone's own
  // POSTPONABLE_STATUSES (not ACTIVE_STATUSES, so an already-postponed event
  // can't be postponed again). Reuses the same venue release call cancel()
  // uses, synchronously - it releases every venue_bookings row tied to the
  // event regardless of why the event changed.
  //
  // SCRUM-150: equipment release on postpone reuses the exact same function
  // cancel() calls above; releaseReservationsForEvent never reads
  // events.status, so the same call is correct here without any new
  // equipment-side code path. (A reschedule releases the same way too, as of
  // SCRUM-37's team design - see approve()/reject() above.)
  async function postpone(eventId, actorId, reason, { isCoordinatorLead = false, equipmentService, releaseVenueBookingsForCancelledEvent } = {}) {
    const parsed = readNote(reason);
    // A distinct key from cancel's "reason_required" - same FAILURES map in
    // review.controller.js, different message ("postponing" vs "cancelling").
    if (!parsed.ok || parsed.note === null) return { ok: false, reason: "postpone_reason_required" };

    const extra = {
      postponed_by: actorId,
      postponed_at: new Date().toISOString(),
      postponement_reason: parsed.note,
    };
    const event = await repository.postpone(eventId, extra, isCoordinatorLead ? undefined : actorId);
    if (!event) {
      const existing = await repository.findById(eventId);
      return { ok: false, reason: existing ? "conflict" : "not_found" };
    }

    await equipmentService?.releaseReservationsForEvent?.(eventId, actorId);
    await releaseVenueBookingsForCancelledEvent?.(eventId);

    return { ok: true, event };
  }

  return { startReview, approve, reject, cancel, postpone };
}

module.exports = { createReviewService, readNote };
