const STATUSES = Object.freeze([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "SAFETY_REVIEW",
  "PREPARATION",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "POSTPONED",
]);

const TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(["SUBMITTED"]),
  SUBMITTED: Object.freeze(["UNDER_REVIEW", "CANCELLED", "POSTPONED"]),
  UNDER_REVIEW: Object.freeze(["CHANGES_REQUESTED", "APPROVED", "REJECTED", "CANCELLED", "POSTPONED"]),
  // SCRUM-117: the owner resubmits to the same assigned coordinator.
  CHANGES_REQUESTED: Object.freeze(["UNDER_REVIEW", "CANCELLED", "POSTPONED"]),
  // SCRUM-144 AC1: no APPROVED -> CONFIRMED; confirming needs the safety pass.
  // SCRUM-37: a significant edit with live arrangements sends an APPROVED
  // event back to SUBMITTED for coordinator re-approval (team design, not
  // this story's own SAFETY_REVIEW withdrawal edge below).
  APPROVED: Object.freeze(["SAFETY_REVIEW", "CANCELLED", "POSTPONED", "SUBMITTED"]),
  // SCRUM-139 AC4: back to APPROVED is the coordinator withdrawing the submission.
  // SCRUM-141 AC3: a Safety Officer's rejection takes the same edge back to
  // planning; only their approval reaches PREPARATION.
  // SCRUM-37: a second, different way out - a significant edit regresses all
  // the way to SUBMITTED instead, since the arrangements that justified
  // reaching Safety Review may no longer be valid.
  SAFETY_REVIEW: Object.freeze(["APPROVED", "PREPARATION", "CANCELLED", "POSTPONED", "SUBMITTED"]),
  // SCRUM-144 AC1: the only way to CONFIRMED. Postponing is left out until the
  // PO agrees it (docs/event-requests.md merge checklist).
  // SCRUM-37: a significant edit regresses to SUBMITTED, same reasoning as
  // the SAFETY_REVIEW edge above.
  PREPARATION: Object.freeze(["CONFIRMED", "CANCELLED", "SUBMITTED"]),
  // SCRUM-37: a significant edit on a CONFIRMED event's arrangements regresses
  // it to SUBMITTED for coordinator re-approval - applied by
  // apply_organiser_event_edit (SQL), not through this module's canTransition.
  CONFIRMED: Object.freeze(["COMPLETED", "CANCELLED", "POSTPONED", "SUBMITTED"]),
  COMPLETED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  REJECTED: Object.freeze([]),
  POSTPONED: Object.freeze(["CANCELLED"]), // SCRUM-149: resume isn't built yet
});

// Events still in progress: counted in workload and eligible for cancellation.
// Reassignment uses ASSIGNABLE_STATUSES below (SCRUM-117).
const ACTIVE_STATUSES = Object.freeze(["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SAFETY_REVIEW", "PREPARATION", "CONFIRMED", "POSTPONED"]);

// SCRUM-117: awaiting organiser corrections keeps workload but freezes reassignment.
const ASSIGNABLE_STATUSES = Object.freeze(ACTIVE_STATUSES.filter(status => status !== "CHANGES_REQUESTED"));

// SCRUM-149/117: neither preparation nor an already-postponed event may be postponed.
const POSTPONABLE_STATUSES = Object.freeze(["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SAFETY_REVIEW", "CONFIRMED"]);

// SCRUM-99 AC1: only approved (and later confirmed) events may have venue and
// equipment arranged. Booking before approval is refused. SAFETY_REVIEW is left
// out on purpose: arrangements are frozen while under review (SCRUM-139 AC4).
// PREPARATION is left out too: changing an arrangement after the safety pass
// would bypass the review that passed it.
const PLANNING_STATUSES = Object.freeze(["APPROVED", "CONFIRMED"]);

function canTransition(from, to) {
  // hasOwn, not `in`: "toString" or "__proto__" must not read as a status.
  if (!Object.hasOwn(TRANSITIONS, from)) return false;
  return TRANSITIONS[from].includes(to);
}

module.exports = { ASSIGNABLE_STATUSES, STATUSES, TRANSITIONS, ACTIVE_STATUSES, POSTPONABLE_STATUSES, PLANNING_STATUSES, canTransition };
