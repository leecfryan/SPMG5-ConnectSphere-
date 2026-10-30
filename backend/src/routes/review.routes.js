const express = require("express");
const createReviewController = require("../modules/events/review.controller");
const requirePermission = require("../middleware/requirePermission");
const { createEventWorkspaceService } = require("../modules/events/eventWorkspace.service");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SCRUM-98 AC4: only the event's assigned coordinator may act on it. An unknown
// id and someone else's event get the same 403, so existence isn't revealed.
// Without storage the lookup throws and requirePermission answers 503.
const assignedToCaller = (repository) => async (req) => UUID_PATTERN.test(req.params.eventId) &&
  (await repository.findById(req.params.eventId))?.coordinator_id === req.user.id;

function createReviewRoutes(repository, cancelDependencies, dataClient) {
  const router = express.Router();
  const controller = createReviewController(repository, cancelDependencies);
  const workspaceService = dataClient && createEventWorkspaceService(dataClient);
  const isAssignedCoordinator = assignedToCaller(repository);
  const guard = requirePermission("events.decide", isAssignedCoordinator);

  // SCRUM-148 AC1: the coordinator lead may cancel any event unconditionally; the
  // coordinator must still be the one assigned to it, same existence-hiding
  // shape as assignedToCaller above.
  const assignedOrCoordinatorLead = async (req) => req.user.roles.includes("event_coordinator_lead") || (await isAssignedCoordinator(req));
  const cancelGuard = requirePermission("events.cancel", assignedOrCoordinatorLead);
  // SCRUM-149: same assigned-or-coordinator-lead check as cancel.
  const postponeGuard = requirePermission("events.postpone", assignedOrCoordinatorLead);

  // SCRUM-165: coordinator decides on a pending change request.
  // Uses the same guard as start-review/approve/reject (assigned coordinator only).
  router.post("/events/:eventId/decide-change-request", guard, async (req, res) => {
    if (!workspaceService) return res.status(503).json({ message: "Event workspace is not configured." });
    try {
      const { decision, reason } = req.body || {};
      const result = await workspaceService.decideChangeRequest(req.user.id, req.params.eventId, decision, reason);
      if (result.ok) return res.json({ event: result.event });
      if (result.reason === "invalid_decision") return res.status(400).json({ message: "Decision must be 'approve' or 'reject'.", errors: [{ field: "decision", message: "Must be 'approve' or 'reject'." }] });
      if (result.reason === "reason_required") return res.status(400).json({ message: "A reason is required.", errors: [{ field: "reason", message: "required" }] });
      if (result.reason === "not_found") return res.status(404).json({ message: "Event not found." });
      if (result.reason === "no_pending_request") return res.status(409).json({ message: "There is no pending change request for this event." });
      return res.status(409).json({ message: "The event has changed. Refresh and try again." });
    } catch (error) {
      console.error("POST /api/internal/events/:eventId/decide-change-request failed:", error.message);
      return res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });
  router.post("/events/:eventId/start-review", guard, controller.startReview);
  router.post("/events/:eventId/request-changes", guard, controller.requestChanges);
  router.post("/events/:eventId/approve", guard, controller.approve);
  router.post("/events/:eventId/reject", guard, controller.reject);
  router.post("/events/:eventId/cancel", cancelGuard, controller.cancel);
  router.post("/events/:eventId/postpone", postponeGuard, controller.postpone);

  return router;
}

module.exports = createReviewRoutes;
module.exports.assignedToCaller = assignedToCaller;
