// SCRUM-31: one coordinator submission is now N sibling rows sharing a
// group_id (see the task note's Data model decision) - both
// EventEquipmentCard.jsx (Technical Support) and EquipmentRequestPage.jsx
// (the coordinator) need to collapse those back into one line per group,
// so the grouping itself lives here once rather than twice.
//
// `requests` is expected already ordered by created_at ascending (every
// backend read of equipment_requests already does this), so `siblings[0]`
// is deterministically the group's first/earliest row - used as the
// clarification thread's anchor (AC3).
export function groupRequestsByGroupId(requests) {
  const byGroup = new Map();
  for (const request of requests) {
    const key = request.group_id;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(request);
  }
  return [...byGroup.values()].map((siblings) => {
    const first = siblings[0];
    return {
      groupId: first.group_id,
      threadRequestId: first.id,
      equipmentType: first.equipment_type,
      borrowStart: first.borrow_start,
      borrowEnd: first.borrow_end,
      technicalRequirement: first.technical_requirement,
      isEssential: siblings.some((request) => request.is_essential === true),
      total: siblings.length,
      reservedCount: siblings.filter((request) => request.status === "APPROVED").length,
      unfulfilledCount: siblings.filter((request) => request.status === "UNFULFILLED").length,
      pendingCount: siblings.filter((request) => request.status === "PENDING").length,
      // Pre-SCRUM-31 statuses (REJECTED/RELEASED/REVIEW_REQUIRED) aren't part
      // of the reserved/unfulfilled/pending picture - a coordinator-facing
      // summary still needs to surface them individually (e.g. SCRUM-150's
      // "Needs re-review" + unavailable sub-label), so they're kept here
      // rather than folded into a count.
      otherStatusSiblings: siblings.filter((request) => !["APPROVED", "UNFULFILLED", "PENDING"].includes(request.status)),
      siblings,
    };
  });
}
