const express = require("express");
const {
  getEquipmentTypes,
  getEquipmentRequests,
  postEquipmentRequest,
  patchEquipmentRequest,
} = require("../modules/equipment/equipment.controller");
const requirePermission = require("../middleware/requirePermission");

// Mounted at "/api" in app.js so the paths below become the full API routes.
// Takes the already-built `authenticate` middleware from app.js instead of
// constructing its own requireAuth(authClient) - see docs/staff-access.md
// "Teammate integration": apply requireAuth before requirePermission on any
// route outside /api/internal.
//
// Catalogue/list reads are intentionally left open for now, matching this
// story's plan. Gating them with the equipment.read permission (already
// defined in auth/permissions.js) is a reasonable next step, same open
// item as VENUE_EDITOR_ROLES in venues.routes.js.
function equipmentRoutes({ authenticate }) {
  const router = express.Router();

  router.get("/equipment-types", getEquipmentTypes);
  router.get("/events/:eventId/equipment-requests", getEquipmentRequests);

  router.post(
    "/events/:eventId/equipment-requests",
    authenticate,
    requirePermission("equipment_requests.write"),
    postEquipmentRequest,
  );
  router.patch(
    "/equipment-requests/:id",
    authenticate,
    requirePermission("equipment_requests.write"),
    patchEquipmentRequest,
  );

  return router;
}

module.exports = equipmentRoutes;
