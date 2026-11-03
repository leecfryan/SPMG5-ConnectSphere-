const express = require("express");
const requirePermission = require("../middleware/requirePermission");
const { isEventId } = require("../modules/managedEvents/managedEvents.validation");
const createManagedEventsController = require("../modules/managedEvents/managedEvents.controller");
const createWaitlistCoordinatorController = require("../modules/registrations/waitlistCoordinator.controller");

module.exports = function createManagedEventsRoutes({
  authenticate,
  managedEventsService,
  waitlistCoordinatorService,
}) {
  const router = express.Router();
  const controller = createManagedEventsController(managedEventsService || {});
  const waitlistController = createWaitlistCoordinatorController(waitlistCoordinatorService || {});
  // Role checks run before storage checks, including when storage is absent.
  const available = (req, res, next) => managedEventsService ? next() : res.status(503).json({
    message: "Managed event information is not configured. Please try again later.",
  });
  const waitlistAvailable = (req, res, next) => (
    managedEventsService && waitlistCoordinatorService
      ? next()
      : res.status(503).json({ message: "Waitlist management is not configured. Please try again later." })
  );

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
  router.get(
    "/:eventId/registration-window",
    authenticate,
    requirePermission("events.registrations.read", canManageEvent),
    available,
    controller.getRegistrationWindow,
  );
  router.patch(
    "/:eventId/registration-window",
    authenticate,
    requirePermission("events.registration-window.update", canManageEvent),
    available,
    controller.updateRegistrationWindow,
  );
  router.get(
    "/:eventId/waitlist",
    authenticate,
    requirePermission("events.waitlist.manage", canManageEvent),
    waitlistAvailable,
    waitlistController.getCoordinatorWaitlist,
  );
  router.get(
    "/:eventId/waitlist/settings",
    authenticate,
    requirePermission("events.waitlist.manage", canManageEvent),
    waitlistAvailable,
    waitlistController.getAutoOffers,
  );
  router.patch(
    "/:eventId/waitlist/settings",
    authenticate,
    requirePermission("events.waitlist.manage", canManageEvent),
    waitlistAvailable,
    waitlistController.setAutoOffers,
  );
  router.post(
    "/:eventId/waitlist/:entryId/promote",
    authenticate,
    requirePermission("events.waitlist.manage", canManageEvent),
    waitlistAvailable,
    waitlistController.promoteEntry,
  );
  return router;
};
