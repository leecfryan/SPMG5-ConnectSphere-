const { createSafetyReviewService } = require("./safetyReview.service");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  return { list, detail };
}

module.exports = createSafetyReviewController;
