const express = require("express");
const supabase = require("../supabase");
const requireDbRole = require("../middleware/requireDbRole");
const { createEquipmentService } = require("../modules/equipment/equipment.service");
const { createEquipmentController } = require("../modules/equipment/equipment.controller");
const { findById: findEventById } = require("../modules/events/events.repository");

// Mounted at "/api" in app.js so the paths below become the full API routes.
// Takes the already-built `authenticate` middleware from app.js instead of
// constructing its own requireAuth(authClient) - see docs/staff-access.md
// "Teammate integration": apply requireAuth before any authorization check
// on any route outside /api/internal.
//
// Role split: Event Coordinators submit requests for an event; Technical
// Support Staff review them (PENDING -> APPROVED/REJECTED). Neither role
// does both. Any authenticated user can list an event's requests.
function equipmentRoutes({ authenticate }) {
  const router = express.Router();
  const equipmentService = createEquipmentService(supabase);
  const controller = createEquipmentController({ equipmentService, findEventById });

  router.get("/equipment", authenticate, controller.getEquipmentCatalogue);
  router.get(
    "/events/:eventId/equipment-requests",
    authenticate,
    controller.getEquipmentRequests,
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

  return router;
}

module.exports = equipmentRoutes;
