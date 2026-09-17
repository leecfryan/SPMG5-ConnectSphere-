// Data access for equipment requests. Exports a factory rather than binding
// straight to the shared Supabase client (contrast venues.service.js /
// events.repository.js): equipment.routes.js binds it to the real client in
// production, and equipment.functional.test.js binds it to an in-memory fake
// so role gating, overlap rejection, and event scoping can be exercised
// without touching the live database (see that test file's header for why).
const { WRITABLE_COLS } = require("./equipment.validation");

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

  // AC4: requests are always looked up by the event they belong to. The
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

  // Overlap guard: true when the same equipment already has a non-REJECTED
  // request whose borrow window intersects [borrowStart, borrowEnd).
  // Standard interval-overlap test: existing.start < new.end AND
  // existing.end > new.start.
  async function hasOverlappingRequest(equipmentId, borrowStart, borrowEnd) {
    const rows = await unwrap(
      await client
        .from(REQUESTS_TABLE)
        .select("id")
        .eq("equipment_id", equipmentId)
        .neq("status", "REJECTED")
        .lt("borrow_start", borrowEnd)
        .gt("borrow_end", borrowStart)
        .limit(1),
      "hasOverlappingRequest",
    );
    return rows.length > 0;
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

  // Atomically guards the PENDING -> APPROVED/REJECTED transition in the
  // query itself (the `.eq("status", "PENDING")` filter), the same pattern
  // markSubmitted() uses in events.repository.js: it avoids a race between a
  // separate check and the update, and returns null instead of throwing when
  // the row was not PENDING (or did not exist).
  async function updateStatus(id, status) {
    return unwrap(
      await client
        .from(REQUESTS_TABLE)
        .update({ status })
        .eq("id", id)
        .eq("status", "PENDING")
        .select()
        .maybeSingle(),
      "updateStatus",
    );
  }

  return {
    listEquipment,
    findEquipmentById,
    listRequestsByEvent,
    findRequestById,
    hasOverlappingRequest,
    createRequest,
    updateStatus,
  };
}

module.exports = { createEquipmentService, WRITABLE_COLS };
