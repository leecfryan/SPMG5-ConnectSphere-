const { createReviewService } = require("./review.service");

const FAILURES = Object.freeze({
  clarification_required: [400, "Explain what the organiser needs to clarify or amend."],
  invalid_note: [400, "The note must be text."],
  note_required: [400, "Give a reason for rejecting this request."],
  reason_required: [400, "Give a reason for cancelling this event."],
  postpone_reason_required: [400, "Give a reason for postponing this event."],
  new_date_incomplete: [400, "Give both a new start and a new end, or leave both empty."],
  new_date_invalid: [400, "The new start and end must be valid dates and times."],
  new_start_past: [400, "The new start must be in the future."],
  new_end_before_start: [400, "The new end must be after the new start."],
  venue_check_unavailable: [503, "We couldn't check the venues for the new date, so the event was not postponed. Please try again."],
  not_found: [404, "That event request no longer exists."],
  conflict: [409, "This event request has changed since you opened it. Refresh to see its current status."],
});

function createReviewController(repository, cancelDependencies = {}) {
  const review = createReviewService({ repository });

  // Identity comes from the verified token only; a body can supply nothing but the note.
  function handle(action, run) {
    return async (req, res) => {
      try {
        const result = await run(req.params.eventId, req.user.id, req.body?.note);
        if (result.ok) return res.json({ event: result.event });
        const [status, message] = FAILURES[result.reason];
        return res.status(status).json({ message });
      } catch (error) {
        console.error(`POST /api/internal/events/:eventId/${action} failed:`, error.message);
        return res.status(500).json({ message: "Something went wrong. Please try again." });
      }
    };
  }

  // SCRUM-171/170: cancel and postpone callers are always the assigned
  // coordinator - the coordinator-lead bypasses were removed.
  async function cancel(req, res) {
    try {
      const result = await review.cancel(req.params.eventId, req.user.id, req.body?.reason, cancelDependencies);
      if (result.ok) return res.json({ event: result.event });
      const [status, message] = FAILURES[result.reason];
      return res.status(status).json({ message });
    } catch (error) {
      console.error("POST /api/internal/events/:eventId/cancel failed:", error.message);
      return res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  }

  // Only the reason and the optional new start/end are read from the body;
  // anything else, such as a status, is ignored.
  async function postpone(req, res) {
    try {
      const result = await review.postpone(req.params.eventId, req.user.id, req.body?.reason, {
        ...cancelDependencies, newStart: req.body?.new_start_time, newEnd: req.body?.new_end_time,
      });
      // SCRUM-170: with a new date, which venues moved and which were released, and why.
      if (result.ok) return res.json({ event: result.event, venue_recheck: result.venueRecheck });
      const [status, message] = FAILURES[result.reason];
      return res.status(status).json({ message });
    } catch (error) {
      console.error("POST /api/internal/events/:eventId/postpone failed:", error.message);
      return res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  }

  // SCRUM-37 team design: approving or rejecting a resubmission releases
  // whatever arrangements it had, same release dependencies cancel/postpone
  // already take. No isCoordinatorLead for either - both stay
  // assigned-coordinator-only, same as the original decision (events.decide,
  // unchanged).
  async function approve(req, res) {
    try {
      const result = await review.approve(req.params.eventId, req.user.id, req.body?.note, cancelDependencies);
      if (result.ok) return res.json({ event: result.event });
      const [status, message] = FAILURES[result.reason];
      return res.status(status).json({ message });
    } catch (error) {
      console.error("POST /api/internal/events/:eventId/approve failed:", error.message);
      return res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  }

  async function reject(req, res) {
    try {
      const result = await review.reject(req.params.eventId, req.user.id, req.body?.note, cancelDependencies);
      if (result.ok) return res.json({ event: result.event });
      const [status, message] = FAILURES[result.reason];
      return res.status(status).json({ message });
    } catch (error) {
      console.error("POST /api/internal/events/:eventId/reject failed:", error.message);
      return res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  }

  return {
    requestChanges: handle("request-changes", review.requestChanges),
    startReview: handle("start-review", review.startReview),
    approve,
    reject,
    cancel,
    postpone,
  };
}

module.exports = createReviewController;
