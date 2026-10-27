const { ACTIVE_STATUSES, ASSIGNABLE_STATUSES } = require("./lifecycle");
const { assignWithHistory } = require("./assignmentHistory.repository");
const { WRITABLE_COLS } = require("./events.repository");
const { compareRequestFields } = require("./requestComparison");
const { normalise } = require("./events.service");
const { validateUpdate, validateForSubmission } = require("./events.validation");

// SCRUM-37: registration_start/registration_end are in WRITABLE_COLS but were
// never selected here, harmlessly, until updateOrganiserEvent started
// merging every writable column onto `current` before calling
// apply_organiser_event_edit (which always writes all of them). Without
// these two, current.registration_start/_end read as undefined, so the RPC
// call silently dropped those two required parameters entirely - breaking
// every edit, not just registration-window ones.
const FIELDS = [
  "id", "name", "purpose", "description", "start_time", "end_time",
  "registration_start", "registration_end", "expected_attendance", "venue_requirements", "accessibility_needs",
  "equipment_needs", "other_comments", "status", "organiser_id",
  "coordinator_id", "submitted_at", "approved_rejected_by", "approved_rejected_at", "approval_rejection_remark",
  "cancelled_by", "cancelled_at", "cancellation_reason",
  "postponed_by", "postponed_at", "postponement_reason", "updated_at",
].join(",");

function isCoordinator(user) {
  return Boolean(user && !user.deleted_at && user.email_confirmed_at &&
    !(new Date(user.banned_until).getTime() > Date.now()) &&
    Array.isArray(user.app_metadata?.roles) && user.app_metadata.roles.includes("event_coordinator"));
}

// SCRUM-150 AC1 used to live here as RESCHEDULE_FIELDS/rescheduleFieldChanged
// (any value change on start_time/end_time/equipment_needs flagged the
// event's equipment_requests for review - a hold-and-recheck model). SCRUM-37
// widened the same significance rule to cover expected_attendance/
// venue_requirements too and moved it into apply_organiser_event_edit (SQL),
// so it runs in the same transaction as the event write it reacts to. Team
// design, 2026-10-21: "for review" is satisfied by the event itself
// regressing to SUBMITTED for the coordinator's decision, not by holding the
// same reservation for Technical Support/Venue Staff to re-decide - approving
// or rejecting the resubmission releases the arrangements outright
// (review.service.js), and the coordinator re-requests fresh ones. SCRUM-150's
// REVIEW_REQUIRED mechanism is therefore unreachable via this trigger now;
// its own task note and docs/equipment-integration.md record why.

function createEventWorkspaceService(client) {
  async function unwrap(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  // SCRUM-100: organisation membership comes only from admin-controlled Auth metadata.
  async function organiserIdsFor(userId) {
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error) throw error;
    const organisationId = data?.user?.app_metadata?.organisation_id;
    if (typeof organisationId !== "string" || !organisationId.trim()) return [userId];
    const ids = new Set([userId]);
    for (let page = 1; ; page += 1) {
      const { data: directory, error: directoryError } = await client.auth.admin.listUsers({ page, perPage: 100 });
      if (directoryError) throw directoryError;
      for (const user of directory.users) {
        if (user.app_metadata?.organisation_id === organisationId) ids.add(user.id);
      }
      if (directory.users.length < 100) break;
    }
    return [...ids];
  }
  function scopedQuery(scope, userId, organiserIds) {
    let query = client.from("events").select(FIELDS);
    // SCRUM-147 AC4: drafts stay out of the shared organisation view, the
    // owner's included; they are reached only through /api/events/drafts.
    if (scope === "organiser") query = query.in("organiser_id", organiserIds).neq("status", "DRAFT");
    // SCRUM-98 AC3: a coordinator keeps seeing the requests they rejected, with the outcome they recorded.
    // SCRUM-148 AC4: and the ones they (or the coordinator lead) cancelled, with its history.
    else if (scope === "coordinator") query = query.eq("coordinator_id", userId).in("status", [...ACTIVE_STATUSES, "REJECTED", "CANCELLED"]);
    else if (scope === "manager") query = query.in("status", [...ACTIVE_STATUSES, "REJECTED", "CANCELLED"]);
    else throw new Error("Unknown event scope");
    return query;
  }
  // SCRUM-99 AC3: the approver's name is shown with the decision. A deleted
  // approver account or a failed lookup leaves the name unknown instead of
  // hiding the event itself.
  async function approverName(id) {
    if (!id) return null;
    const { data, error } = await client.auth.admin.getUserById(id);
    if (error || !data?.user) return null;
    const name = data.user.user_metadata?.full_name;
    return typeof name === "string" && name.trim() ? name.trim() : data.user.email;
  }
  // SCRUM-141 AC4: the event's activity history, newest first, for everyone who
  // may see the event. user_id stays out: the officer pool is not named (#45).
  // Like approverName, a failed read leaves the history unknown (null) instead
  // of hiding the event itself.
  async function activityFor(event, scope) {
    const { data, error } = await client.from("event_activity_log")
      .select("id, action, details, created_at")
      .eq("event_id", event.id).order("created_at", { ascending: false });
    if (error) return { activity: null, ...(scope === "coordinator" ? { request_changes: null } : {}) };
    const baseline = data.find(entry => entry.action === "REQUEST_BASELINE_RECORDED");
    const requestChanges = scope === "coordinator" ? {
      request_changes: baseline ? {
        source: baseline.details.source, version_at: baseline.details.version_at,
        changes: compareRequestFields(baseline.details.snapshot, event),
      } : { source: "NO_BASELINE", version_at: null, changes: [] },
    } : {};
    const activity = data.filter(entry => entry.action !== "REQUEST_BASELINE_RECORDED").map(({ id, action, details, created_at }) => ({
      ...(scope === "coordinator" && action === "REQUEST_RESUBMITTED" ? {
        baseline_source: details.baseline_source ?? null,
        changes: (details.changes || []).filter(change => WRITABLE_COLS.includes(change.field))
          .map(({ field, before, after }) => ({ field, before, after })),
      } : {}),
      id, action, from_status: details.from_status ?? null, to_status: details.to_status ?? null, note: details.note ?? null, created_at,
    }));
    return { activity, ...requestChanges };
  }
  async function read(scope, userId, id) {
    const organiserIds = scope === "organiser" ? await organiserIdsFor(userId) : undefined;
    const query = scopedQuery(scope, userId, organiserIds);
    return unwrap(id ? query.eq("id", id).maybeSingle() : query.order("submitted_at", { ascending: false }));
  }
  return {
    list: (scope, userId) => read(scope, userId),
    async find(scope, userId, id) {
      const event = await read(scope, userId, id);
      return event && {
        ...event,
        approved_rejected_by_name: await approverName(event.approved_rejected_by),
        // SCRUM-148 AC4: same "name, else unknown" treatment as the approve/reject outcome.
        cancelled_by_name: await approverName(event.cancelled_by),
        postponed_by_name: await approverName(event.postponed_by),
        ...await activityFor(event, scope),
      };
    },
    async updateOrganiserEvent(userId, id, input) {
      const current = await read("organiser", userId, id);
      if (!current) return { ok: false, reason: "not_found" };
      if (current.organiser_id !== userId) return { ok: false, reason: "forbidden" };
      if (!input || Array.isArray(input) || typeof input !== "object" ||
        Object.keys(input).length === 0 || Object.keys(input).some(field => !WRITABLE_COLS.includes(field))) {
        return { ok: false, reason: "invalid", errors: [{ field: "event", message: "Provide only editable event details." }] };
      }
      const { fields, errors } = normalise(input);
      const unreadable = new Set(errors.map(problem => problem.field));
      const problems = [...errors, ...validateUpdate(fields, current).errors.filter(problem => !unreadable.has(problem.field))];
      if (problems.length) return { ok: false, reason: "invalid", errors: problems };

      // SCRUM-37: apply_organiser_event_edit (SQL) replaces the plain update
      // this PATCH used to do. It still does everything that update did -
      // SCRUM-100's recheck of responsibility now happens in the function's
      // own WHERE id = ... AND organiser_id = ... (same race-guard shape, not
      // removed, just moved) - and it now also does the significance check
      // (AC1/AC2, widened from SCRUM-150's narrower RESCHEDULE_FIELDS) and the
      // SUBMITTED regression (AC3/AC4) as one transaction with the write.
      // Team design, 2026-10-21: arrangements are released on the
      // coordinator's decision (review.service.js#approve/#reject), not held
      // for re-review here - this function only decides whether to regress,
      // it never touches equipment_requests/venue_bookings itself. The
      // function always writes every column, so a partial PATCH is merged
      // onto the current row first.
      //
      // Reviewer feedback on PR #60: that merge is computed from `current`,
      // read a moment ago in a separate round trip - not from inside the
      // function's own locked read below. If another save for this same
      // event committed in between, `merged` still carries its pre-that-save
      // values for every column this PATCH didn't touch, and writing them
      // would silently revert the other save's change - a lost update, not
      // just a theoretical stale-tab problem. p_expected_updated_at lets the
      // function detect that gap: it compares against the row it locks, and
      // refuses (EVENT_MODIFIED/P0004, mapped to the same conflict below) if
      // `current` was already out of date by the time this call arrived.
      const merged = Object.fromEntries(
        WRITABLE_COLS.map((column) => [column, Object.hasOwn(fields, column) ? fields[column] : current[column]]),
      );
      const { data: event, error } = await client.rpc("apply_organiser_event_edit", {
        p_event_id: id,
        p_organiser_id: userId,
        p_expected_updated_at: current.updated_at,
        p_name: merged.name,
        p_purpose: merged.purpose,
        p_description: merged.description,
        p_start_time: merged.start_time,
        p_end_time: merged.end_time,
        p_registration_start: merged.registration_start,
        p_registration_end: merged.registration_end,
        p_expected_attendance: merged.expected_attendance,
        p_venue_requirements: merged.venue_requirements,
        p_accessibility_needs: merged.accessibility_needs,
        p_equipment_needs: merged.equipment_needs,
        p_other_comments: merged.other_comments,
      }).select(FIELDS).maybeSingle();
      if (error) {
        // EVENT_NOT_FOUND (P0002): the function's own WHERE clause matched
        // nothing - the event moved or was reassigned between the read above
        // and this write. not_found/forbidden are already ruled out by that
        // read, so this is the same race the plain update used to answer
        // with a 409 for.
        if (error.code === "P0002") return { ok: false, reason: "conflict" };
        // EVENT_MODIFIED (P0004): the row exists and is still this
        // organiser's, but its updated_at moved past what `current` read -
        // another save landed in the gap between that read and this call.
        // Same conflict response as P0002: re-read and retry rather than
        // write stale values over whatever that other save changed.
        if (error.code === "P0004") return { ok: false, reason: "conflict" };
        throw error;
      }

      return { ok: true, event };
    },
    async resubmitOrganiserEvent(userId, id, cycleId) {
      const current = await read("organiser", userId, id);
      if (!current) return { ok: false, reason: "not_found" };
      if (current.organiser_id !== userId) return { ok: false, reason: "forbidden" };
      if (current.status !== "CHANGES_REQUESTED" || !current.coordinator_id) return { ok: false, reason: "conflict" };
      const validation = validateForSubmission(current);
      if (!validation.ok) return { ok: false, reason: "invalid", errors: validation.errors };
      // SCRUM-117: the lock rechecks these exact saved values after validation.
      const expected = Object.fromEntries(WRITABLE_COLS.map(field => [field, current[field] ?? null]));
      const event = await unwrap(client.rpc("resubmit_event_request", {
        p_event_id: id, p_organiser_id: userId, p_cycle_id: cycleId, p_expected_fields: expected,
      }).select(FIELDS).maybeSingle());
      return event ? { ok: true, event } : { ok: false, reason: "conflict" };
    },
    async coordinators() {
      const choices = [];
      for (let page = 1; ; page += 1) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw error;
        for (const user of data.users) if (isCoordinator(user)) {
          const name = user.user_metadata?.full_name;
          choices.push({ id: user.id, name: typeof name === "string" && name.trim() ? name.trim() : user.email || user.id, email: user.email });
        }
        if (data.users.length < 100) break;
      }
      return choices.sort((a, b) => a.name.localeCompare(b.name));
    },
    async isCoordinator(id) {
      const { data, error } = await client.auth.admin.getUserById(id);
      if (error?.status === 404) return false;
      if (error) throw error;
      return isCoordinator(data?.user);
    },
    assign(id, coordinatorId, expectedCoordinatorId, actor) {
      return unwrap(assignWithHistory(client, {
        eventId: id, coordinatorId, expectedCoordinatorId,
        allowedStatuses: ASSIGNABLE_STATUSES, actor,
      }).select(FIELDS).maybeSingle());
    },
  };
}

module.exports = { createEventWorkspaceService };
