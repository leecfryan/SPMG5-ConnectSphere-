import { describe, test, expect, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSafetyReviewService } = require("../../../src/modules/events/safetyReview.service");

const EVENT = { id: "evt-1", name: "Community Health Fair", expected_attendance: 180, other_comments: "Single entrance; queue outside." };
const HALL_A = { name: "Hall A", capacity: 200, accessibility_features: ["Step-free access"], notes: "Fire exits on the east wall." };
const HALL_B = { name: "Hall B", capacity: 80, accessibility_features: [], notes: null };

function venueRequest(id, venue, slots) {
  return {
    id, booking_date: "2099-05-01", expected_attendees: 150, room_layout: "Theatre",
    accessibility_requirements: ["Wheelchair seating"], venue, slots,
  };
}

const BOOKED_A = venueRequest("vr-a", HALL_A, [{ slot: "am", status: "confirmed" }, { slot: "pm", status: "cancelled" }]);
const BOOKED_B = venueRequest("vr-b", HALL_B, [{ slot: "night", status: "confirmed" }]);
const PENDING = venueRequest("vr-p", HALL_B, [{ slot: "am", status: "pending" }]);
const REJECTED = venueRequest("vr-r", HALL_B, [{ slot: "pm", status: "rejected" }]);

const equipmentRequest = (id, status) => ({
  id, status, quantity_requested: 2, technical_requirement: "Mounted at the back of the hall", equipment: { type: "Projector" },
});

let repository, safetyReview;

beforeEach(() => {
  repository = {
    findAwaitingSafetyReview: vi.fn(async () => [EVENT]),
    findAwaitingSafetyReviewById: vi.fn(async () => EVENT),
    findArrangements: vi.fn(async () => ({ venueRequests: [BOOKED_A], equipmentRequests: [] })),
  };
  safetyReview = createSafetyReviewService({ repository });
});

test("[SCRUM-140] AC1: the list is the events awaiting safety review, as stored", async () => {
  expect(await safetyReview.list()).toEqual([EVENT]);
});

test("[SCRUM-140] AC2/AC3: a booked venue carries its own capacity, layout, accessibility and notes, with only its confirmed slots", async () => {
  const result = await safetyReview.detail("evt-1");

  expect(result).toEqual({
    ok: true,
    event: EVENT,
    venues: [{
      id: "vr-a", name: "Hall A", booking_date: "2099-05-01", slots: ["am"], expected_attendees: 150, capacity: 200,
      room_layout: "Theatre", accessibility_requirements: ["Wheelchair seating"],
      accessibility_features: ["Step-free access"], notes: "Fire exits on the east wall.",
    }],
    equipment: [],
  });
  expect(repository.findArrangements).toHaveBeenCalledWith("evt-1");
});

test("[SCRUM-140] AC3: each booked venue is returned separately, in the stored order", async () => {
  repository.findArrangements.mockResolvedValue({ venueRequests: [BOOKED_A, BOOKED_B], equipmentRequests: [] });

  const { venues } = await safetyReview.detail("evt-1");

  expect(venues.map((venue) => [venue.name, venue.capacity, venue.slots])).toEqual([
    ["Hall A", 200, ["am"]],
    ["Hall B", 80, ["night"]],
  ]);
  expect(venues[1].notes).toBeNull();
});

test("[SCRUM-140] AC3: pending and rejected venue requests are not shown as arrangements", async () => {
  repository.findArrangements.mockResolvedValue({ venueRequests: [PENDING, BOOKED_A, REJECTED], equipmentRequests: [] });

  const { venues } = await safetyReview.detail("evt-1");

  expect(venues.map((venue) => venue.id)).toEqual(["vr-a"]);
});

test("[SCRUM-140] AC2/AC3: only reserved (APPROVED) equipment is shown, with its quantity and placement", async () => {
  repository.findArrangements.mockResolvedValue({
    venueRequests: [BOOKED_A],
    equipmentRequests: ["PENDING", "APPROVED", "REJECTED", "RELEASED"].map((status) => equipmentRequest(`eq-${status}`, status)),
  });

  const { equipment } = await safetyReview.detail("evt-1");

  expect(equipment).toEqual([
    { id: "eq-APPROVED", type: "Projector", quantity_requested: 2, technical_requirement: "Mounted at the back of the hall" },
  ]);
});

test("[SCRUM-140] an event not awaiting review is not found, and its arrangements are never read", async () => {
  repository.findAwaitingSafetyReviewById.mockResolvedValue(null);

  expect(await safetyReview.detail("evt-9")).toEqual({ ok: false, reason: "not_found" });
  expect(repository.findArrangements).not.toHaveBeenCalled();
});

describe("[SCRUM-141] approve and reject", () => {
  const MOVED = { id: "evt-1", status: "PREPARATION", organiser_id: "org-1", coordinator_id: "coord-1" };

  beforeEach(() => {
    repository.transitionStatus = vi.fn(async (_id, _from, to) => ({ ...MOVED, status: to }));
    repository.findById = vi.fn(async () => ({ id: "evt-1", status: "PREPARATION" }));
    repository.recordActivity = vi.fn(async () => ({ id: "act-1" }));
    repository.undoTransition = vi.fn(async () => ({ id: "evt-1" }));
  });

  test("AC1/AC3: approval moves the event from safety review to preparation, with no coordinator filter", async () => {
    const result = await safetyReview.approve("evt-1", "officer-1");

    expect(result).toEqual({ ok: true, event: { id: "evt-1", status: "PREPARATION" } });
    expect(repository.transitionStatus).toHaveBeenCalledExactlyOnceWith("evt-1", "SAFETY_REVIEW", "PREPARATION");
  });

  test("AC4: approval records who decided, the move and an optional note", async () => {
    await safetyReview.approve("evt-1", "officer-1", "  Stewards briefed  ");
    await safetyReview.approve("evt-1", "officer-1");

    expect(repository.recordActivity.mock.calls).toEqual([
      [{ eventId: "evt-1", actorId: "officer-1", action: "SAFETY_APPROVED", fromStatus: "SAFETY_REVIEW", toStatus: "PREPARATION", note: "Stewards briefed" }],
      [{ eventId: "evt-1", actorId: "officer-1", action: "SAFETY_APPROVED", fromStatus: "SAFETY_REVIEW", toStatus: "PREPARATION", note: null }],
    ]);
  });

  test("AC2/AC3/AC4: rejection with a reason sends the event back to planning, not preparation, and records the reason", async () => {
    const result = await safetyReview.reject("evt-1", "officer-1", "  No fire marshal for 180 people  ");

    expect(result).toEqual({ ok: true, event: { id: "evt-1", status: "APPROVED" } });
    expect(repository.transitionStatus).toHaveBeenCalledExactlyOnceWith("evt-1", "SAFETY_REVIEW", "APPROVED");
    expect(repository.recordActivity).toHaveBeenCalledExactlyOnceWith({
      eventId: "evt-1", actorId: "officer-1", action: "SAFETY_REJECTED", fromStatus: "SAFETY_REVIEW", toStatus: "APPROVED", note: "No fire marshal for 180 people",
    });
  });

  test.each([undefined, null, "", "   ", 42, ["reason"]])("AC2: a rejection without a text reason (%j) is refused and nothing is written", async (reason) => {
    expect(await safetyReview.reject("evt-1", "officer-1", reason)).toEqual({ ok: false, reason: "reason_required" });
    expect(repository.transitionStatus).not.toHaveBeenCalled();
    expect(repository.recordActivity).not.toHaveBeenCalled();
  });

  test("an approval note that is not text is refused and nothing is written", async () => {
    expect(await safetyReview.approve("evt-1", "officer-1", { note: "x" })).toEqual({ ok: false, reason: "invalid_note" });
    expect(repository.transitionStatus).not.toHaveBeenCalled();
  });

  test.each([
    ["an event no longer under review", { id: "evt-1", status: "PREPARATION" }, "conflict"],
    ["an unknown event", null, "not_found"],
  ])("conflict: %s is refused and no history is written", async (_label, existing, reason) => {
    repository.transitionStatus.mockResolvedValue(null);
    repository.findById.mockResolvedValue(existing);

    expect(await safetyReview.approve("evt-1", "officer-1")).toEqual({ ok: false, reason });
    expect(repository.recordActivity).not.toHaveBeenCalled();
  });

  test("failure: when the history row cannot be written the move is undone and the error surfaces", async () => {
    repository.recordActivity.mockRejectedValue(new Error("events.repository: recordActivity failed"));

    await expect(safetyReview.reject("evt-1", "officer-1", "Blocked exit")).rejects.toThrow("recordActivity failed");
    expect(repository.undoTransition).toHaveBeenCalledExactlyOnceWith("evt-1", "SAFETY_REVIEW", "APPROVED");
  });
});
