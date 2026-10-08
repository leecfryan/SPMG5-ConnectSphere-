import { test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { findMissingArrangements } = require("../../../src/modules/events/safetyReadiness");

const venueRequest = (name, date, ...statuses) => ({
  venue: { name },
  booking_date: date,
  slots: statuses.map((status, index) => ({ slot: `slot-${index}`, status })),
});
const equipmentRequest = (type, status) => ({ equipment: { type }, status });

const CONFIRMED_HALL_A = venueRequest("Hall A", "2099-05-01", "confirmed", "confirmed");
const NO_VENUE = { kind: "venue", label: "Venue", reason: "No venue booking has been approved yet." };

test("SCRUM-139 AC1: confirmed venues and approved equipment leave nothing missing", () => {
  expect(findMissingArrangements({
    venueRequests: [CONFIRMED_HALL_A, venueRequest("Hall B", "2099-05-02", "confirmed")],
    equipmentRequests: [equipmentRequest("Projector", "APPROVED")],
  })).toEqual([]);
});

test("SCRUM-139 AC1: an event with no venue request is missing a venue", () => {
  expect(findMissingArrangements({ venueRequests: [], equipmentRequests: [] })).toEqual([NO_VENUE]);
});

test("SCRUM-139 AC1: a pending venue request is missing, even beside a confirmed one", () => {
  expect(findMissingArrangements({
    venueRequests: [CONFIRMED_HALL_A, venueRequest("Hall B", "2099-05-01", "pending")],
    equipmentRequests: [],
  })).toEqual([{ kind: "venue", label: "Hall B · 2099-05-01", reason: "Waiting for Venue Staff to decide." }]);
});

test("SCRUM-139 AC1: rejected and cancelled requests do not block when another venue is confirmed", () => {
  expect(findMissingArrangements({
    venueRequests: [
      CONFIRMED_HALL_A,
      venueRequest("Hall B", "2099-05-01", "rejected"),
      venueRequest("Hall C", "2099-05-01", "cancelled"),
    ],
    equipmentRequests: [],
  })).toEqual([]);
});

test("SCRUM-139 AC1: only rejected or cancelled requests count as no venue", () => {
  expect(findMissingArrangements({
    venueRequests: [venueRequest("Hall B", "2099-05-01", "rejected"), venueRequest("Hall C", "2099-05-01", "cancelled")],
    equipmentRequests: [],
  })).toEqual([NO_VENUE]);
});

test("SCRUM-139 AC1: unattended and issue equipment requests are missing", () => {
  expect(findMissingArrangements({
    venueRequests: [CONFIRMED_HALL_A],
    equipmentRequests: [
      equipmentRequest("Projector", "PENDING"),
      equipmentRequest("Speaker", "REJECTED"),
      equipmentRequest("Microphone", "APPROVED"),
    ],
  })).toEqual([
    { kind: "equipment", label: "Projector", reason: "Waiting for Technical Support Staff to reserve it." },
    { kind: "equipment", label: "Speaker", reason: "Technical Support Staff reported an issue with this request." },
  ]);
});

test.each([
  ["no equipment requests", []],
  ["only released equipment", [equipmentRequest("Projector", "RELEASED")]],
])("SCRUM-139 AC1: %s does not block", (_label, equipmentRequests) => {
  expect(findMissingArrangements({ venueRequests: [CONFIRMED_HALL_A], equipmentRequests })).toEqual([]);
});

test("SCRUM-139 AC2: every missing item is listed together, venue first", () => {
  expect(findMissingArrangements({
    venueRequests: [],
    equipmentRequests: [equipmentRequest("Projector", "PENDING"), equipmentRequest("Speaker", "PENDING")],
  })).toEqual([
    NO_VENUE,
    { kind: "equipment", label: "Projector", reason: "Waiting for Technical Support Staff to reserve it." },
    { kind: "equipment", label: "Speaker", reason: "Waiting for Technical Support Staff to reserve it." },
  ]);
});

test("SCRUM-139 AC1: a request with confirmed and coordinator-cancelled slots counts as booked", () => {
  expect(findMissingArrangements({
    venueRequests: [venueRequest("Hall A", "2099-05-01", "confirmed", "confirmed", "cancelled")],
    equipmentRequests: [],
  })).toEqual([]);
});

test("SCRUM-139 AC1: a request with pending and cancelled slots is still pending", () => {
  expect(findMissingArrangements({
    venueRequests: [CONFIRMED_HALL_A, venueRequest("Hall B", "2099-05-03", "pending", "cancelled")],
    equipmentRequests: [],
  })).toEqual([{ kind: "venue", label: "Hall B · 2099-05-03", reason: "Waiting for Venue Staff to decide." }]);
});

test("SCRUM-139 AC2: a pending venue with nothing booked is listed once, not twice", () => {
  expect(findMissingArrangements({
    venueRequests: [venueRequest("Hall B", "2099-05-01", "pending")],
    equipmentRequests: [],
  })).toEqual([{ kind: "venue", label: "Hall B · 2099-05-01", reason: "Waiting for Venue Staff to decide." }]);
});
