const express = require("express");
const createSafetyCheckController = require("../modules/events/safetyCheck.controller");
const requirePermission = require("../middleware/requirePermission");
const { assignedToCaller } = require("./review.routes");

function createSafetyCheckRoutes(repository) {
  const router = express.Router();
  const controller = createSafetyCheckController(repository);
  const guard = requirePermission("events.safety.submit", assignedToCaller(repository));
  // SCRUM-144: confirming and the essential flag are the assigned coordinator's
  // decisions, the same guard as start review / approve / reject.
  const decideGuard = requirePermission("events.decide", assignedToCaller(repository));

  router.get("/events/:eventId/safety-readiness", guard, controller.readiness);
  router.post("/events/:eventId/submit-safety-check", guard, controller.submit);
  router.post("/events/:eventId/withdraw-safety-check", guard, controller.withdraw);
  router.post("/events/:eventId/confirm", decideGuard, controller.confirm);
  router.patch("/events/:eventId/arrangements/:kind/:requestId", decideGuard, controller.setEssential);

  return router;
}

module.exports = createSafetyCheckRoutes;
