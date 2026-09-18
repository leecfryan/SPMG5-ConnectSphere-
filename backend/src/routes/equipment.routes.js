const express = require("express");
const supabase = require("../supabase");
const requireDbRole = require("../middleware/requireDbRole");
const requireAnyDbRole = require("../middleware/requireAnyDbRole");
const { createEquipmentService } = require("../modules/equipment/equipment.service");
const { createEquipmentController } = require("../modules/equipment/equipment.controller");
const { createMessagesService } = require("../modules/equipment/messages.service");
const { createMessagesController } = require("../modules/equipment/messages.controller");
const retention = require("../modules/equipment/retention");
const { findById: findEventById, findByIds: findEventsByIds } = require("../modules/events/events.repository");

// Scrum-28-Scrum63 (AC1): resolves an auth.users id to a display name for
// the Technical Support dashboard. Wrapped as its own function (rather than
// inlined in the controller) so equipment.functional.test.js can inject a
// fake instead of calling the real Supabase auth admin API.
async function getUserDisplayName(id) {
  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error || !data?.user) return null;
  return data.user.user_metadata?.full_name || data.user.email || null;
}

// Mounted at "/api" in app.js so the paths below become the full API routes.
// Takes the already-built `authenticate` middleware from app.js instead of
// constructing its own requireAuth(authClient) - see docs/staff-access.md
// "Teammate integration": apply requireAuth before any authorization check
// on any route outside /api/internal.
//
// Role split: Event Coordinators submit requests for an event; Technical
// Support Staff review and update them (status: PENDING/APPROVED/REJECTED,
// displayed on the dashboard as Unattended/Assigned/Issues - see
// equipment.controller.js). Neither role does both. Any authenticated user
// can list one event's requests; only Technical Support Staff sees the
// cross-event dashboard.
function equipmentRoutes({ authenticate }) {
  const router = express.Router();
  const equipmentService = createEquipmentService(supabase);
  const controller = createEquipmentController({
    equipmentService,
    findEventById,
    findEventsByIds,
    getUserDisplayName,
  });
  const messagesService = createMessagesService(supabase);
  const messagesController = createMessagesController({
    messagesService,
    equipmentService,
    findEventById,
    retention,
  });

  router.get("/equipment", authenticate, controller.getEquipmentCatalogue);
  router.get(
    "/events/:eventId/equipment-requests",
    authenticate,
    controller.getEquipmentRequests,
  );
  router.get(
    "/technical-support/equipment-requests",
    authenticate,
    requireDbRole("tech_support", supabase),
    controller.getTechSupportDashboard,
  );
  router.post(
    "/events/:eventId/equipment-requests",
    authenticate,
    requireDbRole("event_coordinator", supabase),
    controller.postEquipmentRequest,
  );
  router.patch(
    "/equipment-requests/:id/status",
    authenticate,
    requireDbRole("tech_support", supabase),
    controller.patchRequestStatus,
  );

  // Scrum-28-Scrum65/66 (AC3/AC4): the clarification thread. Unlike the
  // equipment-requests-by-event route above (open to any authenticated
  // user), these are role-gated - AC4 requires the Event Organiser to have
  // no access at all, and the coordinator's access is further scoped to
  // events they coordinate inside messagesController itself.
  const threadRoles = requireAnyDbRole(["tech_support", "event_coordinator"], supabase);
  router.get("/events/:eventId/messages", authenticate, threadRoles, messagesController.getEventMessages);
  router.post("/events/:eventId/messages", authenticate, threadRoles, messagesController.postEventMessage);
  router.patch("/messages/:id", authenticate, threadRoles, messagesController.patchMessage);

  return router;
}

module.exports = equipmentRoutes;
