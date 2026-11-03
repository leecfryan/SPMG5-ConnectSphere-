// Scrum-28-Scrum64 (AC2): the API only ever accepts APPROVED/REJECTED as a
// target (PENDING is a starting state, never selectable - see
// equipment.validation.js's REVIEW_STATUSES). SCRUM-104: RELEASED is the
// same - a request only ever reaches it when its event is cancelled.
// SCRUM-150: REVIEW_REQUIRED is the same again - only a reschedule/postpone
// sets it, and it can only leave that status via the same APPROVED/REJECTED
// decision. Shared between EventEquipmentCard.jsx (Technical Support) and
// EquipmentRequestPage.jsx (the coordinator) so both show the same label.
// SCRUM-31: UNFULFILLED is a sibling Reserve could not cover - terminal,
// never selectable (only reserveGroup writes it).
export const STATUS_LABEL = {
  PENDING: "Unattended", APPROVED: "Assigned", REJECTED: "Issues", RELEASED: "Released",
  REVIEW_REQUIRED: "Needs re-review", UNFULFILLED: "Unfulfilled",
};
