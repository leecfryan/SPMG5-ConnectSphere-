const {
  listEquipmentTypes,
  listRequestsByEvent,
  findRequestById,
  createRequest,
  updateRequest,
} = require("./equipment.service");
const {
  validateCreateRequest,
  validateUpdateRequest,
} = require("./equipment.validation");
const { findById: findEventById } = require("../events/events.repository");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Record-access resolver for requirePermission("equipment_requests.create"):
// a Coordinator may only request equipment for an event they organise or
// coordinate, matching the "Coordinators can insert requests for their
// events" RLS policy in supabase/migrations/003_kl_create_equipment.sql.
// Missing/unrelated events return false; a lookup failure denies access
// (requirePermission's catch turns a throw into 503), same rule staff-access.md
// documents for every other record-scoped permission.
async function authorizeEventOwnership(req) {
  const event = await findEventById(req.params.eventId);
  if (!event) return false;
  return event.coordinator_id === req.user.id || event.organiser_id === req.user.id;
}

async function getEquipmentTypes(req, res, next) {
  try {
    const types = await listEquipmentTypes();
    res.status(200).json({ data: types });
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

    // event_id comes from the URL, not the body - a requester cannot redirect
    // their own request onto a different event by passing a body field.
    const payload = { ...req.body, event_id: eventId };
    const { ok, errors } = validateCreateRequest(payload);
    if (!ok) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    // requireAuth has already verified this identity against Supabase.
    // Never take requestedBy from the request body.
    const request = await createRequest(payload, req.user.id);
    res.status(201).json({ data: request });
  } catch (err) {
    next(err);
  }
}

async function patchEquipmentRequest(req, res, next) {
  try {
    const { id } = req.params;
    if (!UUID_PATTERN.test(id)) {
      return res.status(400).json({ error: "Invalid request id" });
    }

    const { ok, errors } = validateUpdateRequest(req.body);
    if (!ok) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    const existing = await findRequestById(id);
    if (!existing) {
      return res.status(404).json({ error: "Equipment request not found" });
    }

    const updated = await updateRequest(id, req.body);
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getEquipmentTypes,
  getEquipmentRequests,
  postEquipmentRequest,
  patchEquipmentRequest,
  authorizeEventOwnership,
};
