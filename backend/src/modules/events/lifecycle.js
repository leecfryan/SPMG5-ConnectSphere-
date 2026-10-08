const STATUSES = Object.freeze([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "SAFETY_REVIEW",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
]);

const TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(["SUBMITTED"]),
  SUBMITTED: Object.freeze(["UNDER_REVIEW", "CANCELLED"]),
  UNDER_REVIEW: Object.freeze(["APPROVED", "REJECTED", "CANCELLED"]),
  APPROVED: Object.freeze(["SAFETY_REVIEW", "CONFIRMED", "CANCELLED"]),
  // SCRUM-139 AC4: back to APPROVED is the coordinator withdrawing the submission.
  SAFETY_REVIEW: Object.freeze(["APPROVED", "CANCELLED"]),
  CONFIRMED: Object.freeze(["COMPLETED", "CANCELLED"]),
  COMPLETED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  REJECTED: Object.freeze([]),
});

// Events still in progress: counted in a coordinator's workload and open to
// (re)assignment by the Operations Manager (discussions #94, #101).
const ACTIVE_STATUSES = Object.freeze(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "SAFETY_REVIEW", "CONFIRMED"]);

// SCRUM-99 AC1: only approved (and later confirmed) events may have venue and
// equipment arranged. Booking before approval is refused. SAFETY_REVIEW is left
// out on purpose: arrangements are frozen while under review (SCRUM-139 AC4).
const PLANNING_STATUSES = Object.freeze(["APPROVED", "CONFIRMED"]);

function canTransition(from, to) {
  // hasOwn, not `in`: "toString" or "__proto__" must not read as a status.
  if (!Object.hasOwn(TRANSITIONS, from)) return false;
  return TRANSITIONS[from].includes(to);
}

module.exports = { STATUSES, TRANSITIONS, ACTIVE_STATUSES, PLANNING_STATUSES, canTransition };
