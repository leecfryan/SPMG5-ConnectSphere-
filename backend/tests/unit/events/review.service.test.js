import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createReviewService } = require("../../../src/modules/events/review.service");

const NOW = "2026-10-01T02:00:00.000Z";
let repository, review;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  repository = {
    transitionStatus: vi.fn(async (id, from, to, extra) => ({ id, status: to, ...extra })),
    findById: vi.fn(async () => null),
  };
  review = createReviewService({ repository });
});

afterEach(() => { vi.useRealTimers(); });

test("SCRUM-98 AC2: starting review moves SUBMITTED to UNDER_REVIEW for the calling coordinator only", async () => {
  const result = await review.startReview("evt-1", "coord-1");

  expect(repository.transitionStatus).toHaveBeenCalledWith("evt-1", "SUBMITTED", "UNDER_REVIEW", {}, "coord-1");
  expect(result).toEqual({ ok: true, event: { id: "evt-1", status: "UNDER_REVIEW" } });
});

test("SCRUM-99 AC1/SCRUM-98 AC3: approving records the approver, the time and no note", async () => {
  const result = await review.approve("evt-1", "coord-1");

  expect(repository.transitionStatus).toHaveBeenCalledWith("evt-1", "UNDER_REVIEW", "APPROVED",
    { approved_rejected_by: "coord-1", approved_rejected_at: NOW, approval_rejection_remark: null }, "coord-1");
  expect(result.ok).toBe(true);
});

test("SCRUM-99 AC2: approval writes only the decision columns", async () => {
  await review.approve("evt-1", "coord-1", "Looks complete");

  const [, , , extra] = repository.transitionStatus.mock.calls[0];
  expect(Object.keys(extra).sort()).toEqual(["approval_rejection_remark", "approved_rejected_at", "approved_rejected_by"]);
});

test("SCRUM-99: an approval note is trimmed, and a blank one is stored as none", async () => {
  await review.approve("evt-1", "coord-1", "  Looks complete  ");
  await review.approve("evt-2", "coord-1", "   ");

  expect(repository.transitionStatus.mock.calls[0][3].approval_rejection_remark).toBe("Looks complete");
  expect(repository.transitionStatus.mock.calls[1][3].approval_rejection_remark).toBeNull();
});

test.each([42, true, { text: "x" }, ["x"]])(
  "SCRUM-99 boundary: an approval note that is not text (%j) is refused before any write", async (note) => {
    expect(await review.approve("evt-1", "coord-1", note)).toEqual({ ok: false, reason: "invalid_note" });
    expect(repository.transitionStatus).not.toHaveBeenCalled();
  });

test("SCRUM-98 AC3: rejecting records the reviewer, the time and the trimmed reason", async () => {
  await review.reject("evt-1", "coord-1", "  Missing attendance numbers ");

  expect(repository.transitionStatus).toHaveBeenCalledWith("evt-1", "UNDER_REVIEW", "REJECTED",
    { approved_rejected_by: "coord-1", approved_rejected_at: NOW, approval_rejection_remark: "Missing attendance numbers" }, "coord-1");
});

test.each([undefined, null, "", "   ", 42])(
  "SCRUM-98 boundary: a rejection without a written reason (%j) is refused before any write", async (note) => {
    expect(await review.reject("evt-1", "coord-1", note)).toEqual({ ok: false, reason: "note_required" });
    expect(repository.transitionStatus).not.toHaveBeenCalled();
  });

test("SCRUM-98 conflict: a guarded write that matches nothing is a conflict when the event still exists", async () => {
  repository.transitionStatus.mockResolvedValue(null);
  repository.findById.mockResolvedValue({ id: "evt-1", status: "APPROVED" });

  expect(await review.approve("evt-1", "coord-1")).toEqual({ ok: false, reason: "conflict" });
});

test("SCRUM-98: a guarded write that matches nothing is not_found when the event is gone", async () => {
  repository.transitionStatus.mockResolvedValue(null);

  expect(await review.startReview("evt-1", "coord-1")).toEqual({ ok: false, reason: "not_found" });
});

test("[SCRUM-117-UNIT-005] a request deleted before the atomic return is not found", async () => {
  repository.requestChanges = vi.fn(async () => null);
  expect(await review.requestChanges("evt-1", "coord-1", "Clarify attendance.")).toEqual({ ok: false, reason: "not_found" });
});

// SCRUM-37 reviewer feedback (PR #60): the APPROVED/REJECTED write already
// committed by the time these release calls run, so a release throwing must
// not look like the decision itself failed, and one release failing must
// not stop the other from being attempted.
test("TC-37-22: approve still reports ok, and still releases the venue, when the equipment release throws", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const releaseVenueBookingsForCancelledEvent = vi.fn(async () => {});
  const equipmentService = { releaseReservationsForEvent: vi.fn(async () => { throw new Error("db down"); }) };

  const result = await review.approve("evt-1", "coord-1", null, { equipmentService, releaseVenueBookingsForCancelledEvent });

  expect(result.ok).toBe(true);
  expect(releaseVenueBookingsForCancelledEvent).toHaveBeenCalledWith("evt-1");
  expect(console.error).toHaveBeenCalled();
});

test("TC-37-23: reject still reports ok, and still releases equipment, when the venue release throws", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const releaseVenueBookingsForCancelledEvent = vi.fn(async () => { throw new Error("rpc failed"); });
  const equipmentService = { releaseReservationsForEvent: vi.fn(async () => {}) };

  const result = await review.reject("evt-1", "coord-1", "Not enough detail", { equipmentService, releaseVenueBookingsForCancelledEvent });

  expect(result.ok).toBe(true);
  expect(equipmentService.releaseReservationsForEvent).toHaveBeenCalledWith("evt-1", "coord-1");
  expect(console.error).toHaveBeenCalled();
});
