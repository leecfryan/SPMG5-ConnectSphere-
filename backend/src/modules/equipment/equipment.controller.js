const {
  validateCreateRequest,
  validateStatusUpdate,
} = require("./equipment.validation");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Takes its data-access dependencies rather than importing them, so tests
// can supply fakes (see equipment.functional.test.js) instead of hitting the
// live database or a specific event owner's data. equipment.routes.js is the
// only place that wires this to the real equipment service and the real
// events repository.
function createEquipmentController({ equipmentService, findEventById }) {
  const {
    listEquipment,
    findEquipmentById,
    listRequestsByEvent,
    findRequestById,
    hasOverlappingRequest,
    createRequest,
    updateStatus,
  } = equipmentService;

  async function getEquipmentCatalogue(req, res, next) {
    try {
      const equipment = await listEquipment();
      res.status(200).json({ data: equipment });
    } catch (err) {
      next(err);
    }
  }

  async function getEquipmentRequests(req, res, next) {
    try {
      const { eventId } = req.params;
      if (!UUID_PATTERN.test(eventId)) {
        return res.status(400).json({ error: "Invalid event id" });
      }

      const requests = await listRequestsByEvent(eventId);
      res.status(200).json({ data: requests });
    } catch (err) {
      next(err);
    }
  }

  async function postEquipmentRequest(req, res, next) {
    try {
      const { eventId } = req.params;
      if (!UUID_PATTERN.test(eventId)) {
        return res.status(400).json({ error: "Invalid event id" });
      }

      // event_id comes from the URL, not the body - a requester cannot
      // redirect their own request onto a different event via the body.
      const payload = { ...req.body, event_id: eventId };
      const { ok, errors, value } = validateCreateRequest(payload);
      if (!ok) {
        return res.status(400).json({ error: "Validation failed", details: errors });
      }

      const event = await findEventById(value.event_id);
      if (!event) return res.status(404).json({ error: "Event not found" });

      const equipment = await findEquipmentById(value.equipment_id);
      if (!equipment) return res.status(404).json({ error: "Equipment not found" });

      const overlapping = await hasOverlappingRequest(
        value.equipment_id,
        value.borrow_start,
        value.borrow_end,
      );
      if (overlapping) {
        return res.status(409).json({
          error: "This equipment is already requested for an overlapping period",
        });
      }

      // requireAuth has already verified this identity against Supabase.
      // Never take requested_by from the request body.
      const request = await createRequest(value, req.user.id);
      res.status(201).json({ data: request });
    } catch (err) {
      next(err);
    }
  }

  async function patchRequestStatus(req, res, next) {
    try {
      const { id } = req.params;
      if (!UUID_PATTERN.test(id)) {
        return res.status(400).json({ error: "Invalid request id" });
      }

      const { ok, errors, value } = validateStatusUpdate(req.body);
      if (!ok) {
        return res.status(400).json({ error: "Validation failed", details: errors });
      }

      const existing = await findRequestById(id);
      if (!existing) {
        return res.status(404).json({ error: "Equipment request not found" });
      }
      if (existing.status !== "PENDING") {
        return res.status(409).json({ error: "Only pending requests can be reviewed" });
      }

      const updated = await updateStatus(id, value.status);
      if (!updated) {
        // Someone else reviewed it between the check above and this update.
        return res.status(409).json({ error: "Only pending requests can be reviewed" });
      }
      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  return {
    getEquipmentCatalogue,
    getEquipmentRequests,
    postEquipmentRequest,
    patchRequestStatus,
  };
}

module.exports = { createEquipmentController };
