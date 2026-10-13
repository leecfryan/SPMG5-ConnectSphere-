const express = require("express");
const createReviewController = require("../modules/events/review.controller");
const requirePermission = require("../middleware/requirePermission");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SCRUM-98 AC4: only the event's assigned coordinator may act on it. An unknown
// id and someone else's event get the same 403, so existence isn't revealed.
// Without storage the lookup throws and requirePermission answers 503.
const assignedToCaller = (repository) => async (req) => UUID_PATTERN.test(req.params.eventId) &&
  (await repository.findById(req.params.eventId))?.coordinator_id === req.user.id;

function createReviewRoutes(repository, cancelDependencies) {
  const router = express.Router();
  const controller = createReviewController(repository, cancelDependencies);
  const isAssignedCoordinator = assignedToCaller(repository);
  const guard = requirePermission("events.decide", isAssignedCoordinator);

  // SCRUM-148 AC1: the coordinator lead may cancel any event unconditionally; the
  // coordinator must still be the one assigned to it, same existence-hiding
  // shape as assignedToCaller above.
  const assignedOrCoordinatorLead = async (req) => req.user.roles.includes("event_coordinator_lead") || (await isAssignedCoordinator(req));
  const cancelGuard = requirePermission("events.cancel", assignedOrCoordinatorLead);
  // SCRUM-149: same assigned-or-coordinator-lead check as cancel.
  const postponeGuard = requirePermission("events.postpone", assignedOrCoordinatorLead);

  router.post("/events/:eventId/start-review", guard, controller.startReview);
  router.post("/events/:eventId/approve", guard, controller.approve);
  router.post("/events/:eventId/reject", guard, controller.reject);
  router.post("/events/:eventId/cancel", cancelGuard, controller.cancel);
  router.post("/events/:eventId/postpone", postponeGuard, controller.postpone);

  return router;
}

module.exports = createReviewRoutes;
module.exports.assignedToCaller = assignedToCaller;
