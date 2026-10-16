import { test, expect, beforeEach, vi } from "vitest";
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
