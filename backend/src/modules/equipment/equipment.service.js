// Data access for equipment requests. Exports a factory rather than binding
// straight to the shared Supabase client (contrast venues.service.js /
// events.repository.js): equipment.routes.js binds it to the real client in
// production, and equipment.functional.test.js binds it to an in-memory fake
// so role gating, overlap rejection, and event scoping can be exercised
// without touching the live database (see that test file's header for why).
const { randomUUID } = require("node:crypto");
const {
  BLOCKING_REQUEST_STATUSES,
  isBlockingOverlap,
  isStatusAvailable,
  findAvailableUnits,
  groupRequestsByEquipmentId,
  planReservation,
} = require("./equipment.validation");

const REQUESTS_TABLE = "equipment_requests";
const EQUIPMENT_TABLE = "equipment";
const EQUIPMENT_WRITABLE_COLS = ["type", "description", "current_location", "status"];

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
  // does not exist. SCRUM-103 AC4: actingUserId is always the server-verified
  // caller, never taken from the request body.
  async function updateEquipmentStatus(id, status, actingUserId) {
    return unwrap(
      await client.from(EQUIPMENT_TABLE)
        .update({ status, updated_by: actingUserId, updated_at: new Date().toISOString() })
        .eq("id", id).select().maybeSingle(),
      "updateEquipmentStatus",
    );
  }

  // Scrum-30 AC1/AC2: add a new catalogue record - one row is one physical
  // item (see equipment.validation.js's validateCreateEquipment for the
  // field rules this relies on already having been checked).
  async function createEquipment(fields) {
    return unwrap(
      await client.from(EQUIPMENT_TABLE).insert(pickCol(fields, EQUIPMENT_WRITABLE_COLS)).select().single(),
      "createEquipment",
    );
  }

  // Scrum-30 AC1/AC2: edit an existing record's type, description, location
  // or status. Returns null only when the row does not exist. SCRUM-103 AC4:
  // actingUserId is always the server-verified caller, never the body.
  async function updateEquipment(id, fields, actingUserId) {
    return unwrap(
      await client.from(EQUIPMENT_TABLE)
        .update({ ...pickCol(fields, EQUIPMENT_WRITABLE_COLS), updated_by: actingUserId, updated_at: new Date().toISOString() })
        .eq("id", id).select().maybeSingle(),
      "updateEquipment",
    );
  }

  // Scrum-30 AC1: retire is a deliberate lifecycle action, not a status
  // choice - it always sets UNAVAILABLE and nothing else, and never deletes
  // the row (history and any past requests still reference it). Returns
  // null only when the row does not exist. SCRUM-103 AC4: actingUserId is
  // always the server-verified caller, never the body.
  async function retireEquipment(id, actingUserId) {
    return unwrap(
      await client.from(EQUIPMENT_TABLE)
        .update({ status: "UNAVAILABLE", updated_by: actingUserId, updated_at: new Date().toISOString() })
        .eq("id", id).select().maybeSingle(),
      "retireEquipment",
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

  // SCRUM-103 AC3: APPROVED-only, unlike listActiveRequestsForEquipment below
  // (which also includes PENDING, for the availability check). Only an
  // APPROVED request counts as "reserved" for the retire-flagging rule - a
  // PENDING one is not yet a commitment to anyone.
  async function listApprovedRequestsForEquipment(equipmentId) {
    return unwrap(
      await client
        .from(REQUESTS_TABLE)
        .select("id, event_id, borrow_start, borrow_end")
        .eq("equipment_id", equipmentId)
        .eq("status", "APPROVED"),
      "listApprovedRequestsForEquipment",
    );
  }

  // SCRUM-103 (added scope): same APPROVED-only reasoning as
  // listApprovedRequestsForEquipment above, batched across many units - for
  // the catalogue's live "in use today" display, not a single retire action.
  async function listApprovedRequestsForEquipmentIds(equipmentIds) {
    if (equipmentIds.length === 0) return [];
    return unwrap(
      await client
        .from(REQUESTS_TABLE)
        .select("equipment_id, borrow_start, borrow_end")
        .in("equipment_id", equipmentIds)
        .eq("status", "APPROVED"),
      "listApprovedRequestsForEquipmentIds",
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

  // SCRUM-31 AC1: one coordinator submission for `quantity_requested` units
  // becomes that many sibling rows - same event/type/window/is_essential,
  // each with no equipment_id yet (a unit is assigned later, by
  // reserveGroup). requestedBy is passed as its own argument, never taken
  // from `fields` - same pattern as organiser_id in events.repository.js.
  async function createRequestGroup(fields, requestedBy) {
    const groupId = randomUUID();
    const row = {
      event_id: fields.event_id,
      equipment_type: fields.equipment_type,
      quantity_requested: 1,
      is_essential: fields.is_essential,
      borrow_start: fields.borrow_start,
      borrow_end: fields.borrow_end,
      requested_by: requestedBy,
      status: "PENDING",
      group_id: groupId,
    };
    if (fields.technical_requirement !== undefined) row.technical_requirement = fields.technical_requirement;

    const rows = Array.from({ length: fields.quantity_requested }, () => ({ ...row }));
    return unwrap(
      await client.from(REQUESTS_TABLE).insert(rows).select(),
      "createRequestGroup",
    );
  }

  // SCRUM-31: every sibling from one coordinator submission.
  async function listRequestsByGroupId(groupId) {
    return unwrap(
      await client.from(REQUESTS_TABLE).select("*").eq("group_id", groupId),
      "listRequestsByGroupId",
    );
  }

  // SCRUM-31 AC1/AC4: assigns a specific unit to one sibling in a single
  // write - the moment this commits, the unit is APPROVED with a real
  // equipment_id, so it immediately enters BLOCKING_REQUEST_STATUSES for the
  // next availability read (AC4 - no separate counter to decrement).
  async function assignUnitToRequest(id, equipmentId) {
    return unwrap(
      await client
        .from(REQUESTS_TABLE)
        .update({ equipment_id: equipmentId, status: "APPROVED" })
        .eq("id", id)
        .select()
        .maybeSingle(),
      "assignUnitToRequest",
    );
  }

  // SCRUM-31: Technical Support's reserve action. Loads the group's still-
  // PENDING siblings (Decision 8/12: an already-APPROVED or UNFULFILLED
  // sibling is never touched again, so a re-run only finishes what's left -
  // TC-04, TC-18), finds the real available units with the exact same
  // SCRUM-29 logic the catalogue/availability endpoints use, and hands the
  // decision to the pure planReservation (AC1/AC2/AC5). Returns null when the
  // group doesn't exist at all (controller maps that to 404); when there is
  // nothing left to reserve, returns an explicit no-op (Decision 12, TC-17)
  // rather than re-deriving availability for nothing.
  async function reserveGroup(groupId) {
    const siblings = await listRequestsByGroupId(groupId);
    if (siblings.length === 0) return null;

    const pendingRequests = siblings.filter((request) => request.status === "PENDING");
    if (pendingRequests.length === 0) {
      return { ok: true, reserved: [], unfulfilled: [] };
    }

    const { equipment_type: type, borrow_start: requestedStart, borrow_end: requestedEnd } = siblings[0];
    const isEssential = siblings.some((request) => request.is_essential === true);

    const equipmentUnits = await listEquipmentByType(type);
    const activeRequests = await listActiveRequestsForEquipment(equipmentUnits.map((unit) => unit.id));
    const availableUnits = findAvailableUnits({
      equipmentUnits,
      requestsByEquipmentId: groupRequestsByEquipmentId(activeRequests),
      requestedStart,
      requestedEnd,
    });

    const plan = planReservation({ pendingRequests, availableUnits, isEssential });
    if (!plan.ok) {
      return { ok: false, reason: plan.reason, availableCount: plan.availableCount, pendingCount: plan.pendingCount };
    }

    const reserved = [];
    for (const { requestId, equipmentId } of plan.assignments) {
      reserved.push(await assignUnitToRequest(requestId, equipmentId));
    }
    const unfulfilled = [];
    for (const requestId of plan.unfulfilledRequestIds) {
      unfulfilled.push(await updateStatus(requestId, "UNFULFILLED"));
    }

    return { ok: true, reserved, unfulfilled };
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

  // SCRUM-150 AC1 ("marks reservations for review") used to be implemented
  // here as flagReservationsForReview, moving every PENDING/APPROVED request
  // on an event to REVIEW_REQUIRED when the organiser changed its date, time
  // or equipment needs. SCRUM-37's team design regresses the event itself to
  // SUBMITTED for the coordinator's decision instead, then releases
  // arrangements outright on approve or reject (review.service.js) - nothing
  // is ever held in a flagged state for Technical Support to re-decide, so
  // this function's job is gone, not moved. SCRUM-150's AC1 is therefore
  // unreachable via this trigger now, and nothing else in this codebase ever
  // writes REVIEW_REQUIRED either - it's a dead status going forward. The
  // rest of this file's SCRUM-150 machinery below (isRequestAvailableForWindow,
  // hasUnresolvedEquipment, the available_for_window badge) stays in place:
  // it's still correct for any row that already carries that status, and a
  // future story could still want a hold-style mechanism. See this story's
  // task note and docs/equipment-integration.md's SCRUM-37 addendum.

  // SCRUM-150 AC2: is this one REVIEW_REQUIRED request's own equipment unit
  // still free for its own borrow window? Checked on demand (read time and
  // at approval time), never stored, matching this lane's existing style of
  // deriving availability live rather than caching a status that could go
  // stale (see docs/equipment-integration.md's note on equipment.status).
  // Only this one unit/window is checked - finding a different unit of the
  // same type that could cover it instead is Technical Support's own manual
  // re-review, not this function's job (see the task note's Deliberately
  // absent list).
  async function isRequestAvailableForWindow(request) {
    const unit = await findEquipmentById(request.equipment_id);
    if (!unit || !isStatusAvailable(unit)) return false;

    const others = await unwrap(
      await client
        .from(REQUESTS_TABLE)
        .select("id, borrow_start, borrow_end")
        .eq("equipment_id", request.equipment_id)
        .neq("id", request.id)
        .in("status", BLOCKING_REQUEST_STATUSES),
      "isRequestAvailableForWindow",
    );
    return !others.some((other) => isBlockingOverlap(other, request.borrow_start, request.borrow_end));
  }

  // SCRUM-150 AC4: equipment's contribution to a future "confirm event"
  // readiness check - there is no caller yet, since nothing in this codebase
  // ever transitions an event to CONFIRMED (see the task note's Found, not
  // built). REVIEW_REQUIRED, PENDING and REJECTED all count as unresolved,
  // deliberately aligned with safetyReadiness.js's existing
  // "REJECTED still blocks because Technical Support can revise it" policy
  // for the same equipment_requests data - two readiness gates over the same
  // table should never silently disagree about the same request. RELEASED
  // and APPROVED are resolved: a released reservation has nothing left to
  // arrange, an approved one is settled. `description` is left generic
  // (no equipment-type join exists at this layer); a future caller can
  // enrich it the same way getTechSupportDashboard's controller already
  // joins equipment type onto raw requests, if it wants to.
  const UNRESOLVED_EQUIPMENT_REASONS = Object.freeze({
    PENDING: "Waiting for Technical Support Staff to reserve it.",
    REJECTED: "Technical Support Staff reported an issue with this request.",
    REVIEW_REQUIRED: "This reservation needs to be reviewed again after the event was rescheduled.",
  });
  async function hasUnresolvedEquipment(eventId) {
    const requests = await listRequestsByEvent(eventId);
    return requests
      .filter((request) => UNRESOLVED_EQUIPMENT_REASONS[request.status])
      .map((request) => ({
        type: "equipment",
        request_id: request.id,
        description: "Equipment reservation",
        reason: UNRESOLVED_EQUIPMENT_REASONS[request.status],
        essential: true,
      }));
  }

  // SCRUM-104 AC1/AC2: every APPROVED request tied to a cancelled event is
  // released, regardless of its borrow window - unlike SCRUM-103's
  // retire-flagging (which is "today only" because retire has no date
  // context beyond "now"), a cancelled event has a real start/end, so a
  // future-dated APPROVED request is just as moot as one covering today.
  // Re-running this for the same event is safe without an explicit
  // "already RELEASED" guard: the releasable filter below simply matches
  // nothing the second time.
  //
  // SCRUM-148 AC3: a PENDING request also has nothing left to serve once its
  // event is cancelled, so it moves to RELEASED too, not REJECTED - REJECTED
  // is Technical Support Staff's own "can't fulfil this" status (displayed
  // as "Issues" in EventEquipmentCard.jsx) and would misreport why the
  // request stopped mattering. AC3's wording ("equipment reservations are
  // released") applies the same to a reservation that was never approved.
  //
  // SCRUM-150: also called from postpone() (review.service.js), not just
  // cancel - this function never reads events.status, it only needs an
  // eventId, so the same release logic is correct for both. A REVIEW_REQUIRED
  // request (SCRUM-150's reschedule-review flag) is released the same way:
  // whatever triggered the review no longer matters once the event itself is
  // cancelled or postponed, and a cancelled/postponed event must never leave
  // a request stranded in REVIEW_REQUIRED (it has no live reschedule to
  // resolve against any more).
  //
  // AC3 (equipment unit): for each unit that lost an APPROVED or
  // REVIEW_REQUIRED reservation (both can correspond to equipment.status
  // IN_USE), only revert equipment.status to AVAILABLE when it is actually
  // IN_USE and no other PENDING/APPROVED/REVIEW_REQUIRED request still covers
  // today - a unit a technician has deliberately set to
  // DAMAGED/MAINTENANCE/UNDER_MAINTENANCE/UNAVAILABLE is left alone (that is
  // a more specific problem than "this reservation ended"). There is no
  // cancellation endpoint in SCRUM-104 (events.status was set directly in the
  // database there) so actingUserId defaults to null; equipment.updated_by is
  // nullable and is left null rather than inventing a system user when called
  // that way.
  async function releaseReservationsForEvent(eventId, actingUserId = null) {
    const requests = await listRequestsByEvent(eventId);
    const potentiallyInUse = requests.filter(
      (request) => request.status === "APPROVED" || request.status === "REVIEW_REQUIRED",
    );
    const releasable = requests.filter(
      (request) =>
        request.status === "APPROVED" ||
        request.status === "PENDING" ||
        request.status === "REVIEW_REQUIRED",
    );

    const released = [];
    for (const request of releasable) {
      await updateStatus(request.id, "RELEASED");
      released.push(request.id);
    }

    const now = new Date().toISOString();
    const equipmentReverted = [];
    const equipmentSkipped = [];
    for (const equipmentId of new Set(potentiallyInUse.map((request) => request.equipment_id))) {
      const unit = await findEquipmentById(equipmentId);
      if (!unit || unit.status !== "IN_USE") continue;

      const stillActive = await listActiveRequestsForEquipment([equipmentId]);
      if (stillActive.some((request) => isBlockingOverlap(request, now, now))) {
        equipmentSkipped.push(equipmentId);
        continue;
      }

      await updateEquipmentStatus(equipmentId, "AVAILABLE", actingUserId);
      equipmentReverted.push(equipmentId);
    }

    return { released, equipmentReverted, equipmentSkipped };
  }

  return {
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
    createRequestGroup,
    listRequestsByGroupId,
    assignUnitToRequest,
    reserveGroup,
    updateStatus,
    isRequestAvailableForWindow,
    hasUnresolvedEquipment,
    releaseReservationsForEvent,
  };
}

module.exports = { createEquipmentService };
