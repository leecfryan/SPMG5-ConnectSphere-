const express = require("express");
const requirePermission = require("../middleware/requirePermission");
const { isEventId } = require("../modules/managedEvents/managedEvents.validation");
const createManagedEventsController = require("../modules/managedEvents/managedEvents.controller");

module.exports = function createManagedEventsRoutes({ authenticate, managedEventsService }) {
  const router = express.Router();
  const controller = createManagedEventsController(managedEventsService || {});
  // Role checks run before storage checks, including when storage is absent.
  const available = (req, res, next) => managedEventsService ? next() : res.status(503).json({
    message: "Managed event information is not configured. Please try again later.",
  });

  // One scoped lookup decides both questions the resolver must answer: does this
  // event exist, and is it the caller's? The row is stashed for the controller,
  // and because the lookup is filtered by ownership, an event that belongs to
  // someone else and one that was never created both answer false here.
  async function canManageEvent(req) {
    if (!isEventId(req.params.eventId)) return false;
    const event = await managedEventsService.findManagedEvent(req.params.eventId, req.user.id);
    if (!event) return false;
    req.managedEvent = event;
    return true;
  }

  router.get("/", authenticate, requirePermission("events.managed.read"), available, controller.listManagedEvents);
  router.get("/:eventId", authenticate, requirePermission("events.registrations.read", canManageEvent), available, controller.getRegistrationSummary);
  return router;
};
