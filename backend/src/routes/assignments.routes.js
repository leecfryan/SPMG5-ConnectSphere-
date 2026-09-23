const express = require("express");
const createAssignmentsController = require("../modules/events/assignments.controller");
const requirePermission = require("../middleware/requirePermission");

function createAssignmentsRoutes(dependencies) {
  const router = express.Router();
  const controller = createAssignmentsController(dependencies);
  const guard = requirePermission("events.assign_coordinator");

  router.get("/events/unassigned", guard, controller.listQueue);
  router.get("/coordinators", guard, controller.listCoordinators);
  router.put("/events/:eventId/coordinator", guard, controller.assign);

  return router;
}

module.exports = createAssignmentsRoutes;
