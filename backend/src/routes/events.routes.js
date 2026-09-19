const express = require("express");
const createEventsController = require("../modules/events/events.controller");

// createApp applies verified authentication and events.submit before this router.
function createEventsRoutes(repository) {
  const router = express.Router();
  router.post("/", createEventsController(repository));
  return router;
}

module.exports = createEventsRoutes;
