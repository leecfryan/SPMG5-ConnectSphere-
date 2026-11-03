import { describe, expect, test } from "vitest";
import { groupRequestsByGroupId } from "./groupRequests";

function row(overrides) {
  return {
    id: "r1", group_id: "g1", equipment_type: "Projector", status: "PENDING",
    is_essential: false, quantity_requested: 1,
    borrow_start: "2026-01-01T09:00:00Z", borrow_end: "2026-01-01T17:00:00Z",
    ...overrides,
  };
}

describe("groupRequestsByGroupId", () => {
  test("TC-13: collapses siblings into one group with reserved/unfulfilled/pending counts", () => {
    const requests = [
      row({ id: "r1", status: "APPROVED" }),
      row({ id: "r2", status: "APPROVED" }),
      row({ id: "r3", status: "UNFULFILLED" }),
      row({ id: "r4", status: "PENDING" }),
    ];
    const [group] = groupRequestsByGroupId(requests);
    expect(group.groupId).toBe("g1");
    expect(group.equipmentType).toBe("Projector");
    expect(group.total).toBe(4);
    expect(group.reservedCount).toBe(2);
    expect(group.unfulfilledCount).toBe(1);
    expect(group.pendingCount).toBe(1);
  });

  test("the thread anchor is the first (earliest) sibling, not any other", () => {
    const requests = [row({ id: "first" }), row({ id: "second" })];
    const [group] = groupRequestsByGroupId(requests);
    expect(group.threadRequestId).toBe("first");
  });

  test("a group is essential if any sibling is, even if most aren't", () => {
    const requests = [row({ id: "r1", is_essential: false }), row({ id: "r2", is_essential: true })];
    const [group] = groupRequestsByGroupId(requests);
    expect(group.isEssential).toBe(true);
  });

  test("two different group_ids produce two separate groups", () => {
    const requests = [row({ id: "r1", group_id: "g1" }), row({ id: "r2", group_id: "g2" })];
    const groups = groupRequestsByGroupId(requests);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.groupId).sort()).toEqual(["g1", "g2"]);
  });

  test("REJECTED/RELEASED/REVIEW_REQUIRED siblings are kept individually, not folded into a count", () => {
    const requests = [row({ id: "r1", status: "REVIEW_REQUIRED", available_for_window: false })];
    const [group] = groupRequestsByGroupId(requests);
    expect(group.reservedCount + group.unfulfilledCount + group.pendingCount).toBe(0);
    expect(group.otherStatusSiblings).toEqual([requests[0]]);
  });

  test("an empty list produces no groups", () => {
    expect(groupRequestsByGroupId([])).toEqual([]);
  });
});
