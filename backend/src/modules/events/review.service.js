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

  // SCRUM-98 AC3: the decision records who made it and when. decided_by is kept
  // apart from coordinator_id so a later reassignment can't rewrite it (#94).
  function outcome(coordinatorId, note) {
    return { decided_by: coordinatorId, decided_at: new Date().toISOString(), decision_note: note };
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

  return { startReview, approve, reject };
}

module.exports = { createReviewService };
