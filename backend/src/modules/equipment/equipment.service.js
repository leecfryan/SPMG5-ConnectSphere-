const supabase = require("../../supabase");
const { UPDATABLE_FIELDS } = require("./equipment.validation");

// equipment_type is a read-only catalogue for this story (SCRUM: equipment
// request). Availability/reservation of individual units is a separate,
// future functionality area - see the feature context doc.
const TYPES_TABLE = "equipment_type";
const REQUESTS_TABLE = "event_equipment_request";

// Columns a caller may set when creating a request. requested_by is
// deliberately excluded: it's never client input, it's passed as its own
// argument by the controller, same as organiser_id in events.repository.js.
const WRITABLE_COLS = [
  "event_id",
  "equipment_type_id",
  "quantity_requested",
  "technical_requirements",
];

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

async function listEquipmentTypes() {
  return unwrap(
    await supabase
      .from(TYPES_TABLE)
      .select("id, name, category, description")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    "listEquipmentTypes",
  );
}

// AC4: requests are always looked up by the event they belong to.
async function listRequestsByEvent(eventId) {
  return unwrap(
    await supabase
      .from(REQUESTS_TABLE)
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true }),
    "listRequestsByEvent",
  );
}

async function findRequestById(id) {
  return unwrap(
    await supabase
      .from(REQUESTS_TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle(),
    "findRequestById",
  );
}

async function createRequest(fields, requestedBy) {
  const row = { ...pickCol(fields, WRITABLE_COLS), requested_by: requestedBy };
  return unwrap(
    await supabase.from(REQUESTS_TABLE).insert(row).select().single(),
    "createRequest",
  );
}

// Reuses validation's UPDATABLE_FIELDS as the write allowlist too, so the
// two never drift apart - unlike events.validation.js/events.repository.js,
// which keep separate lists on purpose because importing repository.js into
// validation.js would pull in the Supabase client. That risk only runs one
// direction: validation.js has no side-effecting imports, so service.js
// importing from it is safe.
async function updateRequest(id, changes) {
  const row = pickCol(changes, UPDATABLE_FIELDS);
  if (Object.keys(row).length === 0) return findRequestById(id);
  return unwrap(
    await supabase
      .from(REQUESTS_TABLE)
      .update(row)
      .eq("id", id)
      .select()
      .maybeSingle(),
    "updateRequest",
  );
}

module.exports = {
  WRITABLE_COLS,
  listEquipmentTypes,
  listRequestsByEvent,
  findRequestById,
  createRequest,
  updateRequest,
};
