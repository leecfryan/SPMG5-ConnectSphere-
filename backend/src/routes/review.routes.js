const express = require("express");
const createReviewController = require("../modules/events/review.controller");
const requirePermission = require("../middleware/requirePermission");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createReviewRoutes(repository) {
  const router = express.Router();
  const controller = createReviewController(repository);

  // SCRUM-98 AC4: only the event's assigned coordinator may act on it. An unknown
  // id and someone else's event get the same 403, so existence isn't revealed.
  // Without storage the lookup throws and requirePermission answers 503.
  const assignedToCaller = async (req) => UUID_PATTERN.test(req.params.eventId) &&
    (await repository.findById(req.params.eventId))?.coordinator_id === req.user.id;
  const guard = requirePermission("events.decide", assignedToCaller);

  router.post("/events/:eventId/start-review", guard, controller.startReview);
  router.post("/events/:eventId/approve", guard, controller.approve);
  router.post("/events/:eventId/reject", guard, controller.reject);

  return router;
}

module.exports = createReviewRoutes;
