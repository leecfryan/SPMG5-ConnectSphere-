const express = require("express");
const createSafetyReviewController = require("../modules/events/safetyReview.controller");
const requirePermission = require("../middleware/requirePermission");

// SCRUM-140 AC4: events.safety.read is a *.read permission, so requirePermission
// refuses every method but GET/HEAD. No write path exists for the Safety Officer.
function createSafetyReviewRoutes(repository) {
  const router = express.Router();
  const controller = createSafetyReviewController(repository);
  const guard = requirePermission("events.safety.read");
  const configured = (req, res, next) => repository ? next() :
    res.status(503).json({ message: "Safety review is not configured." });

  router.use("/safety-reviews", guard, configured);
  router.get("/safety-reviews", controller.list);
  router.get("/safety-reviews/:eventId", controller.detail);

  return router;
}

module.exports = createSafetyReviewRoutes;
