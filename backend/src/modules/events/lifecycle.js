const STATUSES = Object.freeze([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
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
  APPROVED: Object.freeze(["CONFIRMED", "CANCELLED", "POSTPONED"]),
  CONFIRMED: Object.freeze(["COMPLETED", "CANCELLED", "POSTPONED"]),
  COMPLETED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  REJECTED: Object.freeze([]),
  POSTPONED: Object.freeze(["CANCELLED"]), // SCRUM-149: resume isn't built yet
});

// Events still in progress: counted in a coordinator's workload and open to
// (re)assignment by the Operations Manager (discussions #94, #101).
// POSTPONED joins this list (SCRUM-149): still the coordinator's responsibility.
const ACTIVE_STATUSES = Object.freeze(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "CONFIRMED", "POSTPONED"]);

// SCRUM-149: ACTIVE_STATUSES minus POSTPONED, so an already-postponed event can't be postponed again.
const POSTPONABLE_STATUSES = Object.freeze(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "CONFIRMED"]);

// SCRUM-99 AC1: only approved (and later confirmed) events may have venue and
// equipment arranged. Booking before approval is refused.
const PLANNING_STATUSES = Object.freeze(["APPROVED", "CONFIRMED"]);

function canTransition(from, to) {
  // hasOwn, not `in`: "toString" or "__proto__" must not read as a status.
  if (!Object.hasOwn(TRANSITIONS, from)) return false;
  return TRANSITIONS[from].includes(to);
}

module.exports = { STATUSES, TRANSITIONS, ACTIVE_STATUSES, POSTPONABLE_STATUSES, PLANNING_STATUSES, canTransition };
