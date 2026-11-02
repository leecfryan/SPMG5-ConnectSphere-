// A missing note is null; anything other than text is refused.
function readNote(note) {
  if (note === undefined || note === null) return { ok: true, note: null };
  if (typeof note !== "string") return { ok: false };
  return { ok: true, note: note.trim() || null };
}

// SCRUM-170: a postponement's optional new date. Both ends or neither; the start
// in the future and the end after it, the same rule as a submitted event's dates.
function readNewSchedule(start, end) {
  const blank = (value) => value === undefined || value === null || value === "";
  if (blank(start) && blank(end)) return { ok: true, start: null, end: null };
  if (blank(start) || blank(end)) return { ok: false, reason: "new_date_incomplete" };
  const startMillis = typeof start === "string" ? Date.parse(start) : NaN;
  const endMillis = typeof end === "string" ? Date.parse(end) : NaN;
  if (Number.isNaN(startMillis) || Number.isNaN(endMillis)) return { ok: false, reason: "new_date_invalid" };
  if (startMillis <= Date.now()) return { ok: false, reason: "new_start_past" };
  if (endMillis <= startMillis) return { ok: false, reason: "new_end_before_start" };
  return { ok: true, start: new Date(startMillis).toISOString(), end: new Date(endMillis).toISOString() };
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

  // Review feedback on SCRUM-37: move() already committed the APPROVED/REJECTED
  // write by the time these run, so a release throwing must not surface as a
  // 500 that implies the decision itself failed. Each release is independent
  // and logged, not thrown - REJECTED is swept for leftovers by
  // equipment.controller.js's releaseReservationsForTerminalEvents and its
  // venues equivalent, same as CANCELLED; APPROVED has no such sweep (plenty
  // of APPROVED events legitimately hold live arrangements), so a failure
  // here is a known gap the log is for.
  async function releaseArrangements(action, eventId, actorId, { equipmentService, releaseVenueBookingsForCancelledEvent } = {}) {
    try {
      await equipmentService?.releaseReservationsForEvent?.(eventId, actorId);
    } catch (error) {
      console.error(`${action} ${eventId}: equipment release failed:`, error.message);
    }
    try {
      await releaseVenueBookingsForCancelledEvent?.(eventId);
    } catch (error) {
      console.error(`${action} ${eventId}: venue release failed:`, error.message);
    }
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

    await releaseArrangements("approve", eventId, coordinatorId, { equipmentService, releaseVenueBookingsForCancelledEvent });

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

    await releaseArrangements("reject", eventId, coordinatorId, { equipmentService, releaseVenueBookingsForCancelledEvent });

    return result;
  }

  // SCRUM-148 AC1/AC2, narrowed by SCRUM-171: only the assigned coordinator may
  // cancel, at any active stage including POSTPONED, with a required reason.
  // Unlike move(), cancel has no single `from` status, so it uses
  // repository.cancel instead of transitionStatus - see events.repository.js.
  // The write is always guarded to the coordinator still holding the event,
  // same race-guard shape as move() (postpone(), below, keeps its own
  // coordinator-lead bypass unchanged).
  //
  // AC3: release what the event was holding. Equipment is in-lane; venue
  // release is an optional, owner-approved seam (see the task note's
  // Decisions). Both run synchronously here so AC3 is true the moment
  // cancellation is saved, not only on a later equipment read.
  async function cancel(eventId, actorId, reason, { equipmentService, releaseVenueBookingsForCancelledEvent } = {}) {
    const parsed = readNote(reason);
    if (!parsed.ok || parsed.note === null) return { ok: false, reason: "reason_required" };

    const extra = {
      cancelled_by: actorId,
      cancelled_at: new Date().toISOString(),
      cancellation_reason: parsed.note,
    };
    const event = await repository.cancel(eventId, extra, actorId);
    if (!event) {
      const existing = await repository.findById(eventId);
      return { ok: false, reason: existing ? "conflict" : "not_found" };
    }

    await equipmentService?.releaseReservationsForEvent?.(eventId, actorId);
    await releaseVenueBookingsForCancelledEvent?.(eventId);

    return { ok: true, event };
  }

  // SCRUM-170: the assigned coordinator postpones with a required reason; a new
  // date is optional (AC2). repository.postpone is one database transaction that
  // also handles the event's venue bookings and holds, writes its history and
  // queues its notifications, so a refused or repeated postpone (AC3) changes
  // and sends nothing. With a new date, the venue checks run first and only
  // bookings that pass on the new date are moved; the rest are released.
  //
  // SCRUM-150: equipment is still released here, by the same call cancel()
  // makes. The postponement is already saved by then, so a release failure is
  // logged rather than reported as a failed postponement.
  async function postpone(eventId, actorId, reason, { equipmentService, checkVenuesForNewDates, newStart, newEnd } = {}) {
    const parsed = readNote(reason);
    // A distinct key from cancel's "reason_required" - same FAILURES map in
    // review.controller.js, different message ("postponing" vs "cancelling").
    if (!parsed.ok || parsed.note === null) return { ok: false, reason: "postpone_reason_required" };
    const schedule = readNewSchedule(newStart, newEnd);
    if (!schedule.ok) return { ok: false, reason: schedule.reason };

    let venueRecheck = null;
    if (schedule.start) {
      const current = await repository.findById(eventId);
      if (!current) return { ok: false, reason: "not_found" };
      try {
        venueRecheck = await checkVenuesForNewDates(current, schedule.start, schedule.end);
      } catch (error) {
        console.error(`postpone ${eventId}: venue checks for the new date failed:`, error.message);
        return { ok: false, reason: "venue_check_unavailable" };
      }
    }
    const moves = (venueRecheck ?? []).filter((result) => result.passed)
      .map((result) => ({ request_id: result.booking_id, booking_date: result.new_booking_date }));

    const event = await repository.postpone(eventId, actorId, parsed.note, { newStart: schedule.start, newEnd: schedule.end, moves });
    if (!event) {
      const existing = await repository.findById(eventId);
      return { ok: false, reason: existing ? "conflict" : "not_found" };
    }

    try {
      await equipmentService?.releaseReservationsForEvent?.(eventId, actorId);
    } catch (error) {
      console.error(`postpone ${eventId}: equipment release failed:`, error.message);
    }

    return { ok: true, event, venueRecheck };
  }

  async function requestChanges(eventId, coordinatorId, note) {
    const parsed = readNote(note);
    if (!parsed.ok || parsed.note === null) return { ok: false, reason: "clarification_required" };
    const event = await repository.requestChanges(eventId, coordinatorId, parsed.note);
    if (event) return { ok: true, event };
    const existing = await repository.findById(eventId);
    return { ok: false, reason: existing ? "conflict" : "not_found" };
  }

  return { startReview, approve, reject, cancel, postpone, requestChanges };
}

module.exports = { createReviewService, readNote };
