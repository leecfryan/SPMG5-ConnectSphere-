const express = require("express");
const requirePermission = require("../middleware/requirePermission");
const { createEventWorkspaceService } = require("../modules/events/eventWorkspace.service");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = value => typeof value === "string" && UUID.test(value);

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
      res.json({ events: await service.list(scope, req.user.id) });
    });
    router.get(`/${scope}/:id`, requirePermission(permission), available, validId, async (req, res) => {
      const event = await service.find(scope, req.user.id, req.params.id);
      if (!event) return res.status(404).json({ message: "Event not found." });
      res.json({ event });
    });
  }
  router.get("/coordinators", requirePermission("events.assign"), available, async (req, res) => {
    res.json({ coordinators: await service.coordinators() });
  });
  router.patch("/:id/decision", requirePermission("events.review"), available, validId, async (req, res) => {
    if (!validBody(req.body, ["decision"]) || !["accept", "reject"].includes(req.body.decision)) {
      return res.status(400).json({ message: "Choose accept or reject." });
    }
    changed(res, await service.decide(req.params.id, req.body.decision === "accept" ? "ACCEPTED" : "REJECTED"));
  });
  router.patch("/:id/coordinator", requirePermission("events.assign"), available, validId, async (req, res) => {
    if (!validBody(req.body, ["coordinatorId", "expectedCoordinatorId"]) || !isUuid(req.body.coordinatorId) ||
      !(req.body.expectedCoordinatorId === null || isUuid(req.body.expectedCoordinatorId))) {
      return res.status(400).json({ message: "Choose a coordinator and refresh the current assignment." });
    }
    if (!(await service.isCoordinator(req.body.coordinatorId))) {
      return res.status(400).json({ message: "This account is not an active event coordinator." });
    }
    changed(res, await service.assign(req.params.id, req.body.coordinatorId, req.body.expectedCoordinatorId));
  });
  router.patch("/:id/publication", requirePermission("events.review"), available, validId, async (req, res) => {
    if (!validBody(req.body, ["openRegistration"]) || req.body.openRegistration !== true) {
      return res.status(400).json({ message: "Choose to open registration." });
    }
    changed(res, await service.publish(req.params.id));
  });
  return router;
};
