const {
  validateCreateRequest,
  validateStatusUpdate,
} = require("./equipment.validation");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Takes its data-access dependencies rather than importing them, so tests
// can supply fakes (see equipment.functional.test.js) instead of hitting the
// live database or a specific event owner's data. equipment.routes.js is the
// only place that wires this to the real equipment service, the real events
// repository, and the real Supabase auth admin API (findEventsByIds,
// getUserDisplayName).
function createEquipmentController({
  equipmentService,
  findEventById,
  findEventsByIds,
  getUserDisplayName,
}) {
  const {
    listEquipment,
    findEquipmentById,
    listRequestsByEvent,
    findRequestById,
    listAllRequests,
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

  // Scrum-28-Scrum63 (AC1): every event's equipment requests in one place,
  // enriched with the event name, equipment type and requester's display
  // name so Technical Support Staff aren't cross-referencing three screens.
  async function getTechSupportDashboard(req, res, next) {
    try {
      const requests = await listAllRequests();
      if (requests.length === 0) return res.status(200).json({ data: [] });

      const eventIds = [...new Set(requests.map((r) => r.event_id))];
      const requesterIds = [...new Set(requests.map((r) => r.requested_by))];

      const [events, equipment, requesterNames] = await Promise.all([
        findEventsByIds(eventIds),
        listEquipment(),
        Promise.all(requesterIds.map((id) => getUserDisplayName(id))),
      ]);

      const eventById = new Map(events.map((e) => [e.id, e]));
      const equipmentById = new Map(equipment.map((e) => [e.id, e]));
      const nameById = new Map(requesterIds.map((id, i) => [id, requesterNames[i]]));

      const data = requests.map((r) => ({
        ...r,
        event_name: eventById.get(r.event_id)?.name ?? null,
        equipment_type: equipmentById.get(r.equipment_id)?.type ?? null,
        requested_by_name: nameById.get(r.requested_by) ?? null,
      }));

      res.status(200).json({ data });
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

      // Scrum-28-Scrum64 (AC2): unlike Scrum-27's one-way review, status can
      // move between APPROVED and REJECTED repeatedly as arrangements are
      // revised - no precondition on the current status here (see
      // equipment.service.js's updateStatus for the matching data-layer
      // change).
      const updated = await updateStatus(id, value.status);
      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  return {
    getEquipmentCatalogue,
    getEquipmentRequests,
    getTechSupportDashboard,
    postEquipmentRequest,
    patchRequestStatus,
  };
}

module.exports = { createEquipmentController };
