// Data access for equipment requests. Exports a factory rather than binding
// straight to the shared Supabase client (contrast venues.service.js /
// events.repository.js): equipment.routes.js binds it to the real client in
// production, and equipment.functional.test.js binds it to an in-memory fake
// so role gating, overlap rejection, and event scoping can be exercised
// without touching the live database (see that test file's header for why).
const { WRITABLE_COLS, BLOCKING_REQUEST_STATUSES, isBlockingOverlap } = require("./equipment.validation");

const REQUESTS_TABLE = "equipment_requests";
const EQUIPMENT_TABLE = "equipment";

function pickCol(input, cols) {
  const source = input && typeof input === "object" ? input : {};
  const row = {};
  for (const column of cols) {
    if (source[column] !== undefined) row[column] = source[column];
  }
  return row;
}

function unwrap({ data, error }, action) {
  if (error) {
    throw new Error(`equipment.service: ${action} failed - ${error.message}`);
  }
  return data;
}

function createEquipmentService(client) {
  // The requestable catalogue for the create form's equipment dropdown.
  async function listEquipment() {
    return unwrap(
      await client.from(EQUIPMENT_TABLE).select("*").order("type", { ascending: true }),
      "listEquipment",
    );
  }

  async function findEquipmentById(id) {
    return unwrap(
      await client.from(EQUIPMENT_TABLE).select("*").eq("id", id).maybeSingle(),
      "findEquipmentById",
    );
  }

  // Technical Support Staff manually record a status
  // change (e.g. AVAILABLE -> MAINTENANCE). Returns null only when the row
  // does not exist.
  async function updateEquipmentStatus(id, status) {
    return unwrap(
      await client.from(EQUIPMENT_TABLE).update({ status }).eq("id", id).select().maybeSingle(),
      "updateEquipmentStatus",
    );
  }

  // scrum-27 AC4: requests are always looked up by the event they belong to. The
  // equipment_requests.event_id foreign key is declared "on delete cascade"
  // in the existing schema, so removing an event removes its requests at the
  // database level - that guarantee lives in Postgres, not here.
  async function listRequestsByEvent(eventId) {
    return unwrap(
      await client
        .from(REQUESTS_TABLE)
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true }),
      "listRequestsByEvent",
    );
  }

  async function findRequestById(id) {
    return unwrap(
      await client.from(REQUESTS_TABLE).select("*").eq("id", id).maybeSingle(),
      "findRequestById",
    );
  }

  // Scrum-28-Scrum63 (AC1): the Technical Support dashboard reviews requests
  // across every event, not one at a time - unlike listRequestsByEvent, this
  // is intentionally unscoped.
  async function listAllRequests() {
    return unwrap(
      await client
        .from(REQUESTS_TABLE)
        .select("*")
        .order("created_at", { ascending: true }),
      "listAllRequests",
    );
  }

  // Superseded by the Scrum-29 team decision (day-granularity, touching
  // endpoints blocked - see equipment.validation.js's isBlockingOverlap).
  // Kept only for reference in case the team revisits this.
  // async function hasOverlappingRequest(equipmentId, borrowStart, borrowEnd) {
  //   const rows = await unwrap(
  //     await client
  //       .from(REQUESTS_TABLE)
  //       .select("id")
  //       .eq("equipment_id", equipmentId)
  //       .neq("status", "REJECTED")
  //       .lt("borrow_start", borrowEnd)
  //       .gt("borrow_end", borrowStart)
  //       .limit(1),
  //     "hasOverlappingRequest",
  //   );
  //   return rows.length > 0;
  // }

  // Overlap guard, Scrum-29 AC2/AC4: true when the same equipment already
  // has a PENDING/APPROVED request whose borrow window blocks the requested
  // period under isBlockingOverlap (day-granularity, touching endpoints
  // blocked). Shared with the availability check so this endpoint and that
  // check can never disagree about whether an item is bookable.
  async function hasOverlappingRequest(equipmentId, borrowStart, borrowEnd) {
    const existing = await unwrap(
      await client
        .from(REQUESTS_TABLE)
        .select("borrow_start, borrow_end")
        .eq("equipment_id", equipmentId)
        .in("status", BLOCKING_REQUEST_STATUSES),
      "hasOverlappingRequest",
    );
    return existing.some((request) => isBlockingOverlap(request, borrowStart, borrowEnd));
  }

  // Scrum-29 AC1/AC2: the requestable catalogue for one equipment type, used
  // by the availability check to know which physical units to consider.
  async function listEquipmentByType(type) {
    return unwrap(
      await client.from(EQUIPMENT_TABLE).select("*").eq("type", type),
      "listEquipmentByType",
    );
  }

  // Scrum-29 AC2/AC4: the PENDING/APPROVED requests for a set of equipment
  // units, so the availability check can apply isBlockingOverlap per unit.
  async function listActiveRequestsForEquipment(equipmentIds) {
    if (equipmentIds.length === 0) return [];
    return unwrap(
      await client
        .from(REQUESTS_TABLE)
        .select("equipment_id, borrow_start, borrow_end")
        .in("equipment_id", equipmentIds)
        .in("status", BLOCKING_REQUEST_STATUSES),
      "listActiveRequestsForEquipment",
    );
  }

  // requestedBy is passed as its own argument, never taken from `fields` -
  // same pattern as organiser_id in events.repository.js.
  async function createRequest(fields, requestedBy) {
    const row = {
      ...pickCol(fields, WRITABLE_COLS),
      requested_by: requestedBy,
      status: "PENDING",
    };
    return unwrap(
      await client.from(REQUESTS_TABLE).insert(row).select().single(),
      "createRequest",
    );
  }

  // Scrum-28-Scrum64 (AC2): Technical Support Staff update this request's
  // status as equipment arrangements progress, not just once. Originally
  // (Scrum-27) this only allowed a single PENDING -> APPROVED/REJECTED
  // transition, guarded by an `.eq("status", "PENDING")` filter in the query
  // itself. That one-way gate is deliberately removed here: the same
  // APPROVED/REJECTED values are reused as this story's arrangement
  // tracking (see equipment.controller.js's top-of-file comment for the
  // full mapping), and arrangements can be revised repeatedly as planning
  // progresses, so the update is now unconditional on the current status.
  // Returns null only when the row does not exist.
  async function updateStatus(id, status) {
    return unwrap(
      await client
        .from(REQUESTS_TABLE)
        .update({ status })
        .eq("id", id)
        .select()
        .maybeSingle(),
      "updateStatus",
    );
  }

  return {
    listEquipment,
    findEquipmentById,
    updateEquipmentStatus,
    listRequestsByEvent,
    findRequestById,
    listAllRequests,
    hasOverlappingRequest,
    listEquipmentByType,
    listActiveRequestsForEquipment,
    createRequest,
    updateStatus,
  };
}

module.exports = { createEquipmentService, WRITABLE_COLS };
