const {
  validateCreateRequest,
  validateStatusUpdate,
  validateAvailabilityQuery,
  validateAvailabilityWindow,
  validateEquipmentStatusUpdate,
  validateCreateEquipment,
  validateUpdateEquipment,
  checkAvailability,
  findAvailableUnits,
  isStatusAvailable,
  isBlockingOverlap,
} = require("./equipment.validation");
const { PLANNING_STATUSES } = require("../events/lifecycle");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared by getEquipmentCatalogue's optional window filter and
// getEquipmentAvailability: equipment_id -> that unit's PENDING/APPROVED requests.
function groupRequestsByEquipmentId(requests) {
  const requestsByEquipmentId = new Map();
  for (const request of requests) {
    const forUnit = requestsByEquipmentId.get(request.equipment_id) || [];
    forUnit.push(request);
    requestsByEquipmentId.set(request.equipment_id, forUnit);
  }
  return requestsByEquipmentId;
}

// SCRUM-103 (added scope): display-only - never written to the equipment row
// (see equipment.service.js's listApprovedRequestsForEquipmentIds). An
// AVAILABLE unit covered by an APPROVED request today reads as IN_USE on
// this response; the stored status is untouched, so this self-corrects on
// the next read once today no longer falls in the request's window, with no
// revert code needed. A unit already in a non-AVAILABLE condition (DAMAGED,
// etc.) is left alone - that's a more specific problem than "booked today".
function withLiveInUseToday(equipmentUnits, approvedRequestsByEquipmentId) {
  const now = new Date().toISOString();
  return equipmentUnits.map((unit) => {
    if (unit.status !== "AVAILABLE") return unit;
    const requests = approvedRequestsByEquipmentId.get(unit.id) || [];
    const inUseToday = requests.some((request) => isBlockingOverlap(request, now, now));
    return inUseToday ? { ...unit, status: "IN_USE" } : unit;
  });
}

// Takes its data-access dependencies rather than importing them, so tests
// can supply fakes (see equipment.functional.test.js) instead of hitting the
// live database or a specific event owner's data. equipment.routes.js is the
// only place that wires this to the real equipment service, the real events
// repository, and the real Supabase auth admin API (findEventsByIds,
// getUserDisplayName).
function createEquipmentController({
  equipmentService,
  messagesService,
  findEventById,
  findEventsByIds,
  getUserDisplayName,
}) {
  const {
    listEquipment,
    findEquipmentById,
    updateEquipmentStatus,
    createEquipment,
    updateEquipment,
    retireEquipment,
    listRequestsByEvent,
    findRequestById,
    listAllRequests,
    hasOverlappingRequest,
    listEquipmentByType,
    listActiveRequestsForEquipment,
    listApprovedRequestsForEquipment,
    listApprovedRequestsForEquipmentIds,
    createRequest,
    updateStatus,
  } = equipmentService;
  const { create: createMessage } = messagesService;

  // SCRUM-103 AC3: equipment just went UNAVAILABLE - every APPROVED request
  // whose reservation covers today is now at risk. "Covers the day" reuses
  // isBlockingOverlap with today as both the requested start and end, which
  // collapses its day-truncated overlap rule to a single-day check - retire
  // has no query window to compare against, only "now" (see the task note's
  // Decisions for why this is today-only, not future-inclusive).
  // PENDING/REJECTED requests are excluded by construction -
  // listApprovedRequestsForEquipment only reads APPROVED rows, unlike
  // listActiveRequestsForEquipment above.
  //
  // Each affected request moves APPROVED -> REJECTED (dashboard label:
  // Assigned -> Issues - see getTechSupportDashboard's comment), the same
  // transition patchRequestStatus already allows, since the equipment it was
  // assigned to is no longer actually available to fulfil it. The attention
  // message explains why, on the event's own thread.
  async function flagApprovedReservationsOnRetire(equipmentId, actingUserId) {
    const requests = await listApprovedRequestsForEquipment(equipmentId);
    const now = new Date().toISOString();
    const affected = requests.filter((request) => isBlockingOverlap(request, now, now));
    if (affected.length === 0) return;

    const eventIds = [...new Set(affected.map((request) => request.event_id))];
    const events = await findEventsByIds(eventIds);
    const eventById = new Map(events.map((event) => [event.id, event]));

    for (const request of affected) {
      const eventName = eventById.get(request.event_id)?.name || "this event";
      await updateStatus(request.id, "REJECTED");
      await createMessage(
        {
          equipment_request_id: request.id,
          body: `This equipment has been marked unavailable while reserved for "${eventName}". Please arrange alternative equipment.`,
        },
        actingUserId,
        "tech_support",
      );
    }
  }

  // The request form's equipment dropdown. With no start/end query params,
  // this is the full catalogue (unchanged behaviour, used e.g. for the
  // Technical Support dashboard's equipment-type lookups and to label
  // already-made requests). With both start and end given, it narrows to
  // only the units bookable for that period (AC2/AC3/AC4, via the same
  // findAvailableUnits used by getEquipmentAvailability) - so the dropdown
  // can stop offering equipment that would just be rejected on submit.
  async function getEquipmentCatalogue(req, res, next) {
    try {
      const equipment = await listEquipment();
      if (req.query.start === undefined && req.query.end === undefined) {
        const approvedRequests = await listApprovedRequestsForEquipmentIds(equipment.map((unit) => unit.id));
        return res.status(200).json({ data: withLiveInUseToday(equipment, groupRequestsByEquipmentId(approvedRequests)) });
      }

      const { ok, errors, value } = validateAvailabilityWindow(req.query);
      if (!ok) {
        return res.status(400).json({ error: "Validation failed", details: errors });
      }

      const requests = await listActiveRequestsForEquipment(equipment.map((unit) => unit.id));
      const available = findAvailableUnits({
        equipmentUnits: equipment,
        requestsByEquipmentId: groupRequestsByEquipmentId(requests),
        requestedStart: value.start,
        requestedEnd: value.end,
      });
      res.status(200).json({ data: available });
    } catch (err) {
      next(err);
    }
  }

  // Technical Support Staff manually record a status
  // change (e.g. AVAILABLE -> MAINTENANCE) - the only way equipment.status
  // ever changes today, since nothing writes it automatically.
  async function patchEquipmentStatus(req, res, next) {
    try {
      const { id } = req.params;
      if (!UUID_PATTERN.test(id)) {
        return res.status(400).json({ error: "Invalid equipment id" });
      }

      const { ok, errors, value } = validateEquipmentStatusUpdate(req.body);
      if (!ok) {
        return res.status(400).json({ error: "Validation failed", details: errors });
      }

      const updated = await updateEquipmentStatus(id, value.status, req.user.id);
      if (!updated) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  // Scrum-30 AC1/AC2: add a new catalogue record.
  async function postEquipment(req, res, next) {
    try {
      const { ok, errors, value } = validateCreateEquipment(req.body);
      if (!ok) {
        return res.status(400).json({ error: "Validation failed", details: errors });
      }
      const created = await createEquipment(value);
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  }

  // Scrum-30 AC1/AC2: edit an existing record's type, description, location
  // or status - a fuller management action than patchEquipmentStatus above.
  async function patchEquipment(req, res, next) {
    try {
      const { id } = req.params;
      if (!UUID_PATTERN.test(id)) {
        return res.status(400).json({ error: "Invalid equipment id" });
      }

      const { ok, errors, value } = validateUpdateEquipment(req.body);
      if (!ok) {
        return res.status(400).json({ error: "Validation failed", details: errors });
      }

      const updated = await updateEquipment(id, value, req.user.id);
      if (!updated) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  // Scrum-30 AC1: retire - sets status to UNAVAILABLE and nothing else. The
  // row is never deleted (see equipment.service.js's retireEquipment).
  async function patchEquipmentRetire(req, res, next) {
    try {
      const { id } = req.params;
      if (!UUID_PATTERN.test(id)) {
        return res.status(400).json({ error: "Invalid equipment id" });
      }

      const updated = await retireEquipment(id, req.user.id);
      if (!updated) {
        return res.status(404).json({ error: "Equipment not found" });
      }

      await flagApprovedReservationsOnRetire(id, req.user.id);
      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  // Scrum-29: is enough suitable equipment available for an event's period?
  // AC1: accepts start/end date-time, type, quantity and location (location
  // is validated and echoed back but not used for filtering - deferred).
  // AC2/AC3/AC4 are all decided inside checkAvailability/findAvailableUnits.
  async function getEquipmentAvailability(req, res, next) {
    try {
      const { ok, errors, value } = validateAvailabilityQuery(req.query);
      if (!ok) {
        return res.status(400).json({ error: "Validation failed", details: errors });
      }

      const equipmentUnits = await listEquipmentByType(value.type);
      const requests = await listActiveRequestsForEquipment(equipmentUnits.map((unit) => unit.id));

      const result = checkAvailability({
        equipmentUnits,
        requestsByEquipmentId: groupRequestsByEquipmentId(requests),
        requestedStart: value.start,
        requestedEnd: value.end,
        requestedQuantity: value.quantity,
      });

      res.status(200).json({
        data: {
          equipment_type: value.type,
          location: value.location,
          period: { start: value.start, end: value.end },
          ...result,
        },
      });
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
      if (event.coordinator_id !== req.user.id) return res.status(403).json({ error: "You can only request equipment for events assigned to you." });
      if (!PLANNING_STATUSES.includes(event.status)) return res.status(409).json({ error: "The event must be approved before requesting equipment." });

      const equipment = await findEquipmentById(value.equipment_id);
      if (!equipment) return res.status(404).json({ error: "Equipment not found" });

      // Scrum-29 AC3: equipment that is not AVAILABLE (IN_USE, MAINTENANCE,
      // and after the team's status-constraint update, UNAVAILABLE, DAMAGED,
      // UNDER_MAINTENANCE) cannot be requested - matches the availability
      // check's exclusion, so an item shown as unavailable there can never
      // be successfully requested here.
      if (!isStatusAvailable(equipment)) {
        return res.status(409).json({ error: "This equipment is not available for booking." });
      }

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
    patchEquipmentStatus,
    postEquipment,
    patchEquipment,
    patchEquipmentRetire,
    getEquipmentAvailability,
    getEquipmentRequests,
    getTechSupportDashboard,
    postEquipmentRequest,
    patchRequestStatus,
  };
}

module.exports = { createEquipmentController };
