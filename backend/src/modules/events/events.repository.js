// Importing the application/validation must not require administrative credentials.
const getSupabase = () => require("../../supabase");
const { canTransition, ACTIVE_STATUSES, POSTPONABLE_STATUSES } = require("./lifecycle");

const { assignWithHistory } = require("./assignmentHistory.repository");

const TABLE = "events";

const WRITABLE_COLS = [
  "name",
  "purpose",
  "description",
  "start_time",
  "end_time",
  "registration_start",
  "registration_end",
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

// A request submitted straight from the form is inserted already SUBMITTED.
// status and submitted_at are set here, never picked from the caller's fields,
// so a client cannot choose them.
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

// SCRUM-147: a draft keeps status DRAFT and no submitted_at until submitted.
// Every draft read and write is scoped to its organiser, so another account's
// draft matches nothing (AC4).
async function createDraft(fields, organiserId) {
  const row = { ...pickCol(fields), organiser_id: organiserId, status: "DRAFT" };
  return unwrap(
    await getSupabase().from(TABLE).insert(row).select().single(),
    "createDraft",
  );
}

function ownDrafts(organiserId) {
  return getSupabase().from(TABLE).select("*").eq("organiser_id", organiserId).eq("status", "DRAFT");
}

async function findOwnDrafts(organiserId) {
  return unwrap(
    await ownDrafts(organiserId).order("created_at", { ascending: false }),
    "findOwnDrafts",
  );
}

async function findOwnDraft(id, organiserId) {
  return unwrap(await ownDrafts(organiserId).eq("id", id).maybeSingle(), "findOwnDraft");
}

async function updateDraft(id, organiserId, fields) {
  return unwrap(
    await getSupabase()
      .from(TABLE)
      .update(pickCol(fields))
      .eq("id", id)
      .eq("organiser_id", organiserId)
      .eq("status", "DRAFT")
      .select()
      .maybeSingle(),
    "updateDraft",
  );
}

// The draft's last edits are written with the status change, so what was
// validated is exactly what is submitted.
async function markSubmitted(id, organiserId, fields, submittedAt = new Date().toISOString()) {
  return unwrap(
    await getSupabase()
      .from(TABLE)
      .update({ ...pickCol(fields), status: "SUBMITTED", submitted_at: submittedAt })
      .eq("id", id)
      .eq("organiser_id", organiserId)
      .eq("status", "DRAFT")
      .select()
      .maybeSingle(),
    "markSubmitted",
  );
}

// SCRUM-117: the database locks assignment/status and saves history with the transition.
async function requestChanges(id, coordinatorId, message) {
  return unwrap(await getSupabase().rpc("request_event_changes", {
    p_event_id: id,
    p_coordinator_id: coordinatorId,
    p_message: message,
  }).maybeSingle(), "requestChanges");
}

// Recheck the coordinator and expected status in the write to reject stale decisions.
async function transitionStatus(id, from, to, extra = {}, coordinatorId) {
  if (!canTransition(from, to)) {
    throw new Error(`events.repository: ${from} -> ${to} is not a permitted transition`);
  }
  let query = getSupabase()
    .from(TABLE)
    .update({ ...extra, status: to })
    .eq("id", id)
    .eq("status", from);
  if (coordinatorId) query = query.eq("coordinator_id", coordinatorId);
  return unwrap(await query.select().maybeSingle(), "transitionStatus");
}

// SCRUM-148: cancel has no single `from` status - any active
// stages may be cancelled - so it cannot reuse transitionStatus, which checks
// one exact `canTransition(from, to)` pair. coordinatorId, when given, is the
// same race guard as transitionStatus: the write also requires that
// coordinator to still hold the event, so a reassignment before the write
// matches nothing (409). Coordinator-lead callers pass no coordinatorId - they may
// cancel any event, so no coordinator filter is added for them.
async function cancel(id, extra = {}, coordinatorId) {
  let query = getSupabase()
    .from(TABLE)
    .update({ ...extra, status: "CANCELLED" })
    .eq("id", id)
    .in("status", ACTIVE_STATUSES);
  if (coordinatorId) query = query.eq("coordinator_id", coordinatorId);
  return unwrap(await query.select().maybeSingle(), "cancel");
}

// SCRUM-149: same shape as cancel(), gated on POSTPONABLE_STATUSES so an
// already-postponed event cannot be postponed again.
async function postpone(id, extra = {}, coordinatorId) {
  let query = getSupabase()
    .from(TABLE)
    .update({ ...extra, status: "POSTPONED" })
    .eq("id", id)
    .in("status", POSTPONABLE_STATUSES);
  if (coordinatorId) query = query.eq("coordinator_id", coordinatorId);
  return unwrap(await query.select().maybeSingle(), "postpone");
}

async function assignCoordinator(id, coordinatorId, actor) {
  return unwrap(
    await assignWithHistory(getSupabase(), {
      eventId: id, coordinatorId, expectedCoordinatorId: null,
      allowedStatuses: ["SUBMITTED"], actor,
    }).maybeSingle(),
    "assignCoordinator",
  );
}

// SCRUM-159 AC2: what the Lead's queue rows and detail panel show, plus
// organiser_id so the service can name the organiser. Nothing else leaves the table.
const QUEUE_COLUMNS = [
  "id", "name", "status", "organiser_id", "start_time", "end_time", "expected_attendance",
  "purpose", "description", "venue_requirements", "accessibility_needs", "equipment_needs",
  "other_comments", "submitted_at",
].join(", ");

async function findSubmittedUnassigned() {
  return unwrap(
    await getSupabase()
      .from(TABLE)
      .select(QUEUE_COLUMNS)
      .eq("status", "SUBMITTED")
      .is("coordinator_id", null)
      .order("submitted_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    "findSubmittedUnassigned",
  );
}

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

// SCRUM-140: what a Safety Officer needs to judge the event. Organiser,
// coordinator and registration details are left out (discussion #45).
const SAFETY_REVIEW_FIELDS = "id, name, description, start_time, end_time, expected_attendance, accessibility_needs, other_comments";

async function findAwaitingSafetyReview() {
  return unwrap(
    await getSupabase()
      .from(TABLE)
      .select("id, name, start_time, end_time, expected_attendance")
      .eq("status", "SAFETY_REVIEW")
      .order("start_time", { ascending: true }),
    "findAwaitingSafetyReview",
  );
}

async function findAwaitingSafetyReviewById(id) {
  return unwrap(
    await getSupabase()
      .from(TABLE)
      .select(SAFETY_REVIEW_FIELDS)
      .eq("id", id)
      .eq("status", "SAFETY_REVIEW")
      .maybeSingle(),
    "findAwaitingSafetyReviewById",
  );
}

// SCRUM-139: read-only view of the Venue and Equipment lanes' rows for one
// event, shaped for safetyReadiness.js. The "!" hints name the foreign key, as
// venues.service.js does, because venue_bookings links to two tables.
// SCRUM-140 reads the same rows for the safety facts, hence the extra columns.
async function findArrangements(eventId) {
  const supabase = getSupabase();
  const [venueRequests, equipmentRequests] = await Promise.all([
    supabase
      .from("venue_booking_requests")
      .select(
        "id, booking_date, expected_attendees, room_layout, accessibility_requirements, is_essential, " +
        "venue:venues!venue_id(name, capacity, accessibility_features, notes), " +
        "slots:venue_bookings!request_id(slot, status)",
      )
      .eq("event_id", eventId)
      .order("booking_date", { ascending: true }),
    supabase
      .from("equipment_requests")
      .select("id, status, quantity_requested, technical_requirement, is_essential, equipment_type, equipment:equipment!equipment_id(type)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true }),
  ]);
  return {
    venueRequests: unwrap(venueRequests, "findArrangements venue"),
    equipmentRequests: unwrap(equipmentRequests, "findArrangements equipment"),
  };
}

// SCRUM-144 AC4: the one write this lane makes to the Venue and Equipment
// lanes' tables - the coordinator's essential flag, nothing else. Filtered on
// event_id too, so a request id from another event matches nothing (404).
const ARRANGEMENT_TABLES = Object.freeze({ venue: "venue_booking_requests", equipment: "equipment_requests" });
async function setArrangementEssential(kind, requestId, eventId, isEssential) {
  return unwrap(
    await getSupabase()
      .from(ARRANGEMENT_TABLES[kind])
      .update({ is_essential: isEssential })
      .eq("id", requestId)
      .eq("event_id", eventId)
      .select("id, is_essential")
      .maybeSingle(),
    "setArrangementEssential",
  );
}

// SCRUM-141: undoes a transition whose activity row could not be written, so
// a decision never stands without its history. Bypasses canTransition on
// purpose: it restores the status the event had a moment ago.
async function undoTransition(id, from, to) {
  return unwrap(
    await getSupabase().from(TABLE).update({ status: from }).eq("id", id).eq("status", to).select("id").maybeSingle(),
    "undoTransition",
  );
}

// SCRUM-141 AC4: event_activity_log is append-only (the table grants the backend
// select and insert only). The status move and note go in its details column.
async function recordActivity({ eventId, actorId, action, fromStatus, toStatus, note }) {
  return unwrap(
    await getSupabase()
      .from("event_activity_log")
      .insert({ event_id: eventId, user_id: actorId, action, details: { from_status: fromStatus, to_status: toStatus, note } })
      .select()
      .single(),
    "recordActivity",
  );
}

module.exports = {
  WRITABLE_COLS,
  ACTIVE_STATUSES,
  createSubmitted,
  findById,
  findByIds,
  update,
  createDraft,
  findOwnDrafts,
  findOwnDraft,
  updateDraft,
  markSubmitted,
  transitionStatus,
  requestChanges,
  cancel,
  postpone,
  assignCoordinator,
  findSubmittedUnassigned,
  findActiveAssignments,
  findArrangements,
  findAwaitingSafetyReview,
  findAwaitingSafetyReviewById,
  undoTransition,
  recordActivity,
  setArrangementEssential,
};
