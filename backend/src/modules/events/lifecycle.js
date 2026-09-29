const STATUSES = Object.freeze([
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
]);

const TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(["SUBMITTED"]),
  SUBMITTED: Object.freeze(["UNDER_REVIEW", "CANCELLED"]),
  UNDER_REVIEW: Object.freeze(["APPROVED", "REJECTED", "CANCELLED"]),
  APPROVED: Object.freeze(["CONFIRMED", "CANCELLED"]),
  CONFIRMED: Object.freeze(["COMPLETED", "CANCELLED"]),
  COMPLETED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  REJECTED: Object.freeze([]),
});

function canTransition(from, to) {
  // hasOwn, not `in`: "toString" or "__proto__" must not read as a status.
  if (!Object.hasOwn(TRANSITIONS, from)) return false;
  return TRANSITIONS[from].includes(to);
}

module.exports = { STATUSES, TRANSITIONS, canTransition };
