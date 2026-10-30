const express = require("express");
const requirePermission = require("../middleware/requirePermission");
const { createEventWorkspaceService } = require("../modules/events/eventWorkspace.service");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = value => typeof value === "string" && UUID.test(value);

// SCRUM-37: equipmentService is no longer threaded through here - the
// significance check it used to receive flags now lives entirely inside
// apply_organiser_event_edit (SQL), called directly by the service below,
// which only regresses the event's own status rather than touching
// equipment_requests at all.
module.exports = function createEventWorkspaceRoutes(client) {
  const router = express.Router();
  const service = client && createEventWorkspaceService(client);
  const available = (req, res, next) => service ? next() : res.status(503).json({ message: "Event workspace is not configured." });
  const validId = (req, res, next) => isUuid(req.params.id) ? next() : res.status(400).json({ message: "Invalid event id." });
  function validBody(body, keys) {
    return body && !Array.isArray(body) && typeof body === "object" &&
      Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
  }
  const changed = (res, event) => event ? res.json({ event }) : res.status(409).json({ message: "The event is unavailable or has changed. Refresh and try again." });
  for (const [scope, permission] of Object.entries({ organiser: "events.own.read", coordinator: "events.assigned.read", manager: "events.review" })) {
    router.get(`/${scope}`, requirePermission(permission), available, async (req, res) => {
      try {
        res.json({ events: await service.list(scope, req.user.id) });
      } catch {
        res.status(503).json({ message: "Unable to load events. Please try again." });
      }
    });
    router.get(`/${scope}/:id`, requirePermission(permission), available, validId, async (req, res) => {
      try {
        const event = await service.find(scope, req.user.id, req.params.id);
        if (!event) return res.status(404).json({ message: "Event not found." });
        res.json({ event });
      } catch {
        res.status(503).json({ message: "Unable to load the event. Please try again." });
      }
    });
  }
  router.patch("/organiser/:id", requirePermission("events.own.update"), available, validId, async (req, res) => {
    try {
      const result = await service.updateOrganiserEvent(req.user.id, req.params.id, req.body);
      if (result.ok) return res.json({ event: result.event });
      if (result.reason === "not_found") return res.status(404).json({ message: "Event not found." });
      if (result.reason === "forbidden") return res.status(403).json({ message: "You can only edit events you are responsible for." });
      // SCRUM-164 AC2: locked once the event has moved past SUBMITTED.
      if (result.reason === "locked") return res.status(409).json({ message: "Changes to this event are no longer accepted." });
      if (result.reason === "invalid") return res.status(400).json({ message: "Check the event details and try again.", errors: result.errors });
      return res.status(409).json({ message: "The event responsibility has changed. Refresh and try again." });
    } catch {
      return res.status(503).json({ message: "Unable to update the event. Please try again." });
    }
  });
  // SCRUM-36: organiser submits a change request for an UNDER_REVIEW or APPROVED event.
  router.post("/organiser/:id/change-request", requirePermission("events.own.update"), available, validId, async (req, res) => {
    try {
      const result = await service.submitChangeRequest(req.user.id, req.params.id, req.body);
      if (result.ok) return res.status(201).json({ event: result.event });
      if (result.reason === "not_found") return res.status(404).json({ message: "Event not found." });
      if (result.reason === "forbidden") return res.status(403).json({ message: "You can only submit change requests for events you are responsible for." });
      if (result.reason === "invalid") return res.status(400).json({ message: "Check the change request details and try again.", errors: result.errors });
      if (result.reason === "ineligible") return res.status(409).json({ message: "Change requests are only accepted for events under review or approved." });
      if (result.reason === "already_pending") return res.status(409).json({ message: "A change request is already pending for this event." });
      return res.status(409).json({ message: "The event has changed. Refresh and try again." });
    } catch {
      return res.status(503).json({ message: "Unable to submit the change request. Please try again." });
    }
  });
  router.post("/organiser/:id/resubmit", requirePermission("events.own.update"), available, validId, async (req, res) => {
    if (!validBody(req.body, ["cycleId"]) || !isUuid(req.body.cycleId)) {
      return res.status(400).json({ message: "Refresh the request before resubmitting." });
    }
    try {
      const result = await service.resubmitOrganiserEvent(req.user.id, req.params.id, req.body.cycleId);
      if (result.ok) return res.json({ event: result.event });
      if (result.reason === "not_found") return res.status(404).json({ message: "Event not found." });
      if (result.reason === "forbidden") return res.status(403).json({ message: "Only the responsible organiser can resubmit this request." });
      if (result.reason === "invalid") return res.status(400).json({ message: "Edit and save the request details before resubmitting.", errors: result.errors });
      return res.status(409).json({ message: "The request has changed. Refresh and review the saved details before resubmitting." });
    } catch {
      return res.status(503).json({ message: "Unable to resubmit the request. Please try again." });
    }
  });
  router.get("/coordinators", requirePermission("events.assign"), available, async (req, res) => {
    res.json({ coordinators: await service.coordinators() });
  });
  // The manager assigns and reassigns but does not decide: approval belongs to the
  // assigned coordinator (SCRUM-98/99, discussions #80, #101). When registration
  // opens is the Registration lane's registration start time, not a manager action.
  router.patch("/:id/coordinator", requirePermission("events.assign"), available, validId, async (req, res) => {
    if (!validBody(req.body, ["coordinatorId", "expectedCoordinatorId"]) || !isUuid(req.body.coordinatorId) ||
      !(req.body.expectedCoordinatorId === null || isUuid(req.body.expectedCoordinatorId))) {
      return res.status(400).json({ message: "Choose a coordinator and refresh the current assignment." });
    }
    if (!(await service.isCoordinator(req.body.coordinatorId))) {
      return res.status(400).json({ message: "This account is not an active event coordinator." });
    }
    changed(res, await service.assign(req.params.id, req.body.coordinatorId, req.body.expectedCoordinatorId, req.user));
  });
  return router;
};
