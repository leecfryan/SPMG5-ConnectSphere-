const express = require("express");
const createSafetyReviewController = require("../modules/events/safetyReview.controller");
const requirePermission = require("../middleware/requirePermission");

// SCRUM-140 AC4: events.safety.read is a *.read permission, so requirePermission
// refuses every method but GET/HEAD. The only writes are SCRUM-141's two
// decisions, registered first under their own grant; they change the status
// alone, never the event's details.
function createSafetyReviewRoutes(repository) {
  const router = express.Router();
  const controller = createSafetyReviewController(repository);
  const guard = requirePermission("events.safety.read");
  const decideGuard = requirePermission("events.safety.decide");
  const configured = (req, res, next) => repository ? next() :
    res.status(503).json({ message: "Safety review is not configured." });

  router.post("/safety-reviews/:eventId/approve", decideGuard, configured, controller.approve);
  router.post("/safety-reviews/:eventId/reject", decideGuard, configured, controller.reject);
  router.use("/safety-reviews", guard, configured);
  router.get("/safety-reviews", controller.list);
  router.get("/safety-reviews/:eventId", controller.detail);

  return router;
}

module.exports = createSafetyReviewRoutes;
