const { createReviewService } = require("./review.service");

const FAILURES = Object.freeze({
  invalid_note: [400, "The note must be text."],
  note_required: [400, "Give a reason for rejecting this request."],
  not_found: [404, "That event request no longer exists."],
  conflict: [409, "This event request has changed since you opened it. Refresh to see its current status."],
});

function createReviewController(repository) {
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

  return {
    startReview: handle("start-review", review.startReview),
    approve: handle("approve", review.approve),
    reject: handle("reject", review.reject),
  };
}

module.exports = createReviewController;
