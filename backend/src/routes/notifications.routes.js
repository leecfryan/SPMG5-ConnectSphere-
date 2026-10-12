const express = require("express");
const createNotificationsController = require("../modules/notifications/notifications.controller");

function createNotificationsRoutes(service, authenticate) {
  const router = express.Router();
  const controller = createNotificationsController(service);
  router.get("/inbox-config", authenticate, controller.inboxConfig);
  return router;
}

module.exports = createNotificationsRoutes;
