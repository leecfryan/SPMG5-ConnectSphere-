const STATUSES = Object.freeze([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
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
  UNDER_REVIEW: Object.freeze(["APPROVED", "REJECTED", "CANCELLED", "POSTPONED"]),
  APPROVED: Object.freeze(["SAFETY_REVIEW", "CONFIRMED", "CANCELLED", "POSTPONED"]),
  // SCRUM-139 AC4: back to APPROVED is the coordinator withdrawing the submission.
  // SCRUM-141 AC3: a Safety Officer's rejection takes the same edge back to
  // planning; only their approval reaches PREPARATION.
  SAFETY_REVIEW: Object.freeze(["APPROVED", "PREPARATION", "CANCELLED", "POSTPONED"]),
  // SCRUM-141: confirming from here arrives with SCRUM-144. Postponing is left
  // out until the PO agrees it (docs/event-requests.md merge checklist).
  PREPARATION: Object.freeze(["CANCELLED"]),
  CONFIRMED: Object.freeze(["COMPLETED", "CANCELLED", "POSTPONED"]),
  COMPLETED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  REJECTED: Object.freeze([]),
  POSTPONED: Object.freeze(["CANCELLED"]), // SCRUM-149: resume isn't built yet
});

// Events still in progress: counted in a coordinator's workload and open to
// (re)assignment by the Event Coordinator Lead (discussions #94, #101).
// POSTPONED joins this list (SCRUM-149): still the coordinator's responsibility.
// So does PREPARATION (SCRUM-141): the event is still being delivered.
const ACTIVE_STATUSES = Object.freeze(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "SAFETY_REVIEW", "PREPARATION", "CONFIRMED", "POSTPONED"]);

// SCRUM-149: ACTIVE_STATUSES minus POSTPONED, so an already-postponed event can't be postponed again.
const POSTPONABLE_STATUSES = Object.freeze(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "SAFETY_REVIEW", "CONFIRMED"]);

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

module.exports = { STATUSES, TRANSITIONS, ACTIVE_STATUSES, POSTPONABLE_STATUSES, PLANNING_STATUSES, canTransition };
