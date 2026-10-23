// Labels for events.status, one per status in backend lifecycle.js (SCRUM-97).
// APPROVED reads "Approved – planning": the stored value stays APPROVED because
// other lanes query it. An unknown status shows as-is rather than blank, so a
// new backend state is visible instead of hidden.
export const statusLabels = Object.freeze({
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved – planning",
  SAFETY_REVIEW: "Safety review",
  PREPARATION: "Preparation",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
  POSTPONED: "Postponed",
});

// Must match ACTIVE_STATUSES in backend/src/modules/events/lifecycle.js: the
// browser applies the same meaning of "active" when SCRUM-161's overview opens.
export const activeStatuses = Object.freeze([
  "SUBMITTED", "UNDER_REVIEW", "APPROVED", "SAFETY_REVIEW", "PREPARATION", "CONFIRMED", "POSTPONED",
]);
