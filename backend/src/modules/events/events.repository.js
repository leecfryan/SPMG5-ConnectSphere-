const supabase = require("../../supabase");

const TABLE = "events";

const WRITABLE_COLS = [
  "name",
  "purpose",
  "description",
  "start_time",
  "end_time",
  "expected_attendance",
  "venue_requirements",
  "accessibility_needs",
  "equipment_needs",
  "other_comments",
];


function pickCol(input) {
  const source = input && typeof input === "object" ? input : {};
  const row = {};
  for (const column of WRITABLE_COLS) {
    if (source[column] !== undefined) row[column] = source[column]
  }
  return row;
}

function unwrap({ data, error }, action) {
  if (error) {
    throw new Error(`events.repository: ${action} failed - ${error.message}`);
  }
  return data;
}

async function create(fields, organiserId) {
  const row = { ...pickCol(fields), organiser_id: organiserId };
  return unwrap(
    await supabase.from(TABLE).insert(row).select().single(),
    "create",
  );
}

async function findById(id) {
  return unwrap(
    await supabase.from(TABLE).select("*").eq("id", id).maybeSingle(),
    "findById",
  );
}

async function update(id, patch) {
  const row = pickCol(patch);
  if (Object.keys(row).length === 0) return findById(id);
  return unwrap(
    await supabase.from(TABLE).update(row).eq("id", id).select().maybeSingle(),
    "update",
  );
}

async function markSubmitted(id, submittedAt = new Date().toISOString()) {
  return unwrap(
    await supabase
      .from(TABLE)
      .update({ status: "SUBMITTED", submitted_at: submittedAt })
      .eq("id", id)
      .eq("status", "DRAFT")
      .select()
      .maybeSingle(),
    "markSubmitted",
  );
}

async function assignCoordinator(id, coordinatorId) {
  return unwrap(
    await supabase
      .from(TABLE)
      .update({ coordinator_id: coordinatorId })
      .eq("id", id)
      .select()
      .maybeSingle(),
    "assignCoordinator",
  );
}

async function findSubmittedUnassigned() {
  return unwrap(
    await supabase
      .from(TABLE)
      .select("*")
      .eq("status", "SUBMITTED")
      .is("coordinator_id", null)
      .order("submitted_at", { ascending: true }),
    "findSubmittedUnassigned",
  );
}

module.exports = {
  WRITABLE_COLS,
  create,
  findById,
  update,
  markSubmitted,
  assignCoordinator,
  findSubmittedUnassigned,
};