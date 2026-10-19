const { createSafetyReviewService } = require("./safetyReview.service");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FAILURES = Object.freeze({
  invalid_note: [400, "The note must be text."],
  reason_required: [400, "Give a reason for rejecting this safety arrangement."],
  not_found: [404, "That event no longer exists."],
  conflict: [409, "This event is no longer waiting for a safety review. Refresh to see its current status."],
});

function createSafetyReviewController(repository) {
  const safetyReview = createSafetyReviewService({ repository });

  function fail(res, path, error) {
    console.error(`${path} failed:`, error.message);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }

  async function list(req, res) {
    try {
      return res.json({ events: await safetyReview.list() });
    } catch (error) {
      return fail(res, "/api/internal/safety-reviews", error);
    }
  }

  async function detail(req, res) {
    if (!UUID_PATTERN.test(req.params.eventId)) {
      return res.status(400).json({ message: "That event reference is not valid." });
    }
    try {
      const result = await safetyReview.detail(req.params.eventId);
      if (!result.ok) return res.status(404).json({ message: "That event is not waiting for a safety review." });
      const { event, venues, equipment } = result;
      return res.json({ event, venues, equipment });
    } catch (error) {
      return fail(res, "/api/internal/safety-reviews/:eventId", error);
    }
  }

  // SCRUM-141: the officer comes from the verified token; the body supplies only the note or reason.
  function decision(action, run, field) {
    return async (req, res) => {
      if (!UUID_PATTERN.test(req.params.eventId)) {
        return res.status(400).json({ message: "That event reference is not valid." });
      }
      try {
        const result = await run(req.params.eventId, req.user.id, req.body?.[field]);
        if (result.ok) return res.json({ event: result.event });
        const [status, message] = FAILURES[result.reason];
        return res.status(status).json({ message });
      } catch (error) {
        return fail(res, `/api/internal/safety-reviews/:eventId/${action}`, error);
      }
    };
  }

  return {
    list,
    detail,
    approve: decision("approve", safetyReview.approve, "note"),
    reject: decision("reject", safetyReview.reject, "reason"),
  };
}

module.exports = createSafetyReviewController;
