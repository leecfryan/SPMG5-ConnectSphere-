const express = require("express");
const requirePermission = require("../middleware/requirePermission");
const { createEquipmentController } = require("../modules/equipment/equipment.controller");
const { createMessagesController } = require("../modules/equipment/messages.controller");
const retention = require("../modules/equipment/retention");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Storage stays optional at startup and injectable in integration tests.
module.exports = function equipmentRoutes({ authenticate, equipmentService, messagesService,
  findEventById, findEventsByIds, getUserDisplayName, listAssignedEvents }) {
  const router = express.Router();
  const controller = createEquipmentController({ equipmentService: equipmentService || {},
    messagesService: messagesService || {}, findEventById, findEventsByIds, getUserDisplayName });
  const messages = createMessagesController({ messagesService: messagesService || {},
    equipmentService: equipmentService || {}, findEventById, retention });
  const guards = (permission, configured = equipmentService) => [authenticate,
    requirePermission("internal.access"), requirePermission(permission),
    (req, res, next) => configured ? next() : res.status(503).json({ message: "Equipment storage is not configured. Please try again later." })];

  async function loadEvent(req, res, next) {
    if (!UUID_PATTERN.test(req.params.eventId)) return res.status(400).json({ error: "Invalid event id" });
    try {
      req.equipmentEvent = await findEventById(req.params.eventId);
      if (!req.equipmentEvent) return res.status(404).json({ error: "Event not found" });
      next();
    } catch (error) { next(error); }
  }
  const canReadEvent = (req) => Boolean(req.equipmentEvent && (
    req.user.roles.includes("technical_support_staff") || req.equipmentEvent.coordinator_id === req.user.id));
  function assignedCoordinator(req, res, next) {
    if (req.equipmentEvent.coordinator_id !== req.user.id) return res.status(403).json({ message: "You can only request equipment for events assigned to you." });
    next();
  }

  router.get("/equipment", ...guards("equipment.read"), controller.getEquipmentCatalogue);
  // Scrum-30 AC1: add/update/retire a catalogue record - management actions,
  // separate from equipment.review's quick operational-status PATCH below.
  router.post("/equipment", ...guards("equipment.manage"), controller.postEquipment);
  router.patch("/equipment/:id", ...guards("equipment.manage"), controller.patchEquipment);
  router.patch("/equipment/:id/retire", ...guards("equipment.manage"), controller.patchEquipmentRetire);
  // Scrum-29: catalogue-wide check, not scoped to one event or record - same
  // reasoning as GET /equipment above (see staff-access.md: equipment
  // catalogue access is not limited by assigned venue/equipment/location).
  router.get("/equipment/availability", ...guards("equipment.read"), controller.getEquipmentAvailability);
  // Manual status changes are a technical-arrangement
  // action, same permission as reviewing/updating a request's status.
  router.patch("/equipment/:id/status", ...guards("equipment.review"), controller.patchEquipmentStatus);
  router.get("/equipment/events", ...guards("equipment.request"), async (req, res, next) => {
    try { res.json({ data: await listAssignedEvents(req.user.id) }); } catch (error) { next(error); }
  });
  router.get("/events/:eventId/equipment-requests", ...guards("equipment.read"), loadEvent,
    requirePermission("technical_requests.read", canReadEvent), controller.getEquipmentRequests);
  router.post("/events/:eventId/equipment-requests", ...guards("equipment.request"), loadEvent,
    assignedCoordinator, controller.postEquipmentRequest);
  router.get("/technical-support/equipment-requests", ...guards("equipment.review"), controller.getTechSupportDashboard);
  router.patch("/equipment-requests/:id/status", ...guards("equipment.review"), controller.patchRequestStatus);
  // Controllers scope threads and require authorship before editing a message.
  router.get("/events/:eventId/messages", ...guards("equipment.messages", (messagesService && equipmentService) || null), messages.getEventMessages);
  router.post("/events/:eventId/messages", ...guards("equipment.messages", (messagesService && equipmentService) || null), messages.postEventMessage);
  router.patch("/messages/:id", ...guards("equipment.messages", (messagesService && equipmentService) || null), messages.patchMessage);
  return router;
};
