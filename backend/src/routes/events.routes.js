const express = require("express");
const createEventsController = require("../modules/events/events.controller");

const requirePermission = require("../middleware/requirePermission");

// Guard only submission, allowing independently guarded event subresources.
function createEventsRoutes(repository, authenticate) {
  const router = express.Router();
  router.post("/", authenticate, requirePermission("events.submit"), createEventsController(repository));
  return router;
}

module.exports = createEventsRoutes;
