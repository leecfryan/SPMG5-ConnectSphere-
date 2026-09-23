// Importing the application/validation must not require administrative credentials.
const getSupabase = () => require("../../supabase");

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

// Every request is inserted already SUBMITTED - phase one has no drafts (US-13
// brings them). status and submitted_at are set here, never picked from the
// caller's fields, so a client cannot choose them.
async function createSubmitted(
  fields,
  organiserId,
  submittedAt = new Date().toISOString(),
) {
  const row = {
    ...pickCol(fields),
    organiser_id: organiserId,
    status: "SUBMITTED",
    submitted_at: submittedAt,
  };
  return unwrap(
    await getSupabase().from(TABLE).insert(row).select().single(),
    "createSubmitted",
  );
}

async function findById(id) {
  return unwrap(
    await getSupabase().from(TABLE).select("*").eq("id", id).maybeSingle(),
    "findById",
  );
}

// Batch event lookup retained for callers that need several event records.
async function findByIds(ids) {
  if (ids.length === 0) return [];
  return unwrap(
    await getSupabase().from(TABLE).select("*").in("id", ids),
    "findByIds",
  );
}

async function update(id, patch) {
  const row = pickCol(patch);
  if (Object.keys(row).length === 0) return findById(id);
  return unwrap(
    await getSupabase().from(TABLE).update(row).eq("id", id).select().maybeSingle(),
    "update",
  );
}

async function markSubmitted(id, submittedAt = new Date().toISOString()) {
  return unwrap(
    await getSupabase()
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
    await getSupabase()
      .from(TABLE)
      .update({ coordinator_id: coordinatorId })
      .eq("id", id)
      .eq("status", "SUBMITTED")
      .is("coordinator_id", null)
      .select()
      .maybeSingle(),
    "assignCoordinator",
  );
}

async function findSubmittedUnassigned() {
  return unwrap(
    await getSupabase()
      .from(TABLE)
      .select("*")
      .eq("status", "SUBMITTED")
      .is("coordinator_id", null)
      .order("submitted_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    "findSubmittedUnassigned",
  );
}

const ACTIVE_STATUSES = ["SUBMITTED", "APPROVED"];

async function findActiveAssignments() {
  return unwrap(
    await getSupabase()
      .from(TABLE)
      .select("coordinator_id, start_time")
      .in("status", ACTIVE_STATUSES)
      .not("coordinator_id", "is", null),
    "findActiveAssignments",
  );
}

module.exports = {
  WRITABLE_COLS,
  ACTIVE_STATUSES,
  createSubmitted,
  findById,
  findByIds,
  update,
  markSubmitted,
  assignCoordinator,
  findSubmittedUnassigned,
  findActiveAssignments,
};
