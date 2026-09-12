const express = require("express");
const {
  getEquipmentTypes,
  getEquipmentRequests,
  postEquipmentRequest,
  patchEquipmentRequest,
  authorizeEventOwnership,
} = require("../modules/equipment/equipment.controller");
const requirePermission = require("../middleware/requirePermission");

// Mounted at "/api" in app.js so the paths below become the full API routes.
// Takes the already-built `authenticate` middleware from app.js instead of
// constructing its own requireAuth(authClient) - see docs/staff-access.md
// "Teammate integration": apply requireAuth before requirePermission on any
// route outside /api/internal.
//
// Role split (see auth/permissions.js and supabase/migrations/003_kl_create_equipment.sql):
// Coordinators submit requests for their own events; Technical Support Staff
// edit/manage requests. Neither role does both.
function equipmentRoutes({ authenticate }) {
  const router = express.Router();

  router.get(
    "/equipment-types",
    authenticate,
    requirePermission("equipment.read"),
    getEquipmentTypes,
  );
  router.get(
    "/events/:eventId/equipment-requests",
    authenticate,
    requirePermission("equipment.read"),
    getEquipmentRequests,
  );

  router.post(
    "/events/:eventId/equipment-requests",
    authenticate,
    requirePermission("equipment_requests.create", authorizeEventOwnership),
    postEquipmentRequest,
  );
  router.patch(
    "/equipment-requests/:id",
    authenticate,
    requirePermission("equipment_requests.update"),
    patchEquipmentRequest,
  );

  return router;
}

module.exports = equipmentRoutes;
