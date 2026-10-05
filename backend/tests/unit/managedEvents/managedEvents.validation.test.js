// Pure shaping and the :eventId guard. No client and no express: if these
// drift, the response contract drifts with them.

import { test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isEventId, toListItem, toSummary, EVENT_FIELDS } =
  require("../../../src/modules/managedEvents/managedEvents.validation");

const EVENT = {
  id: "3f1c8a52-9d4e-4b7a-8c61-2e5a7b9d0f13",
  name: "Annual Alumni Gala",
  start_time: "2026-10-02T01:00:00Z",
  end_time: "2026-10-02T05:00:00Z",
  status: "APPROVED",
  enrolled_attendees: 42,
  expected_attendance: 120,
};

test("isEventId accepts a UUID and rejects everything else", () => {
  expect(isEventId(EVENT.id)).toBe(true);
  expect(isEventId("3F1C8A52-9D4E-4B7A-8C61-2E5A7B9D0F13")).toBe(true);
  expect(isEventId("not-a-uuid")).toBe(false);
  expect(isEventId("3f1c8a52-9d4e-4b7a-8c61-2e5a7b9d0f13 OR 1=1")).toBe(false);
  expect(isEventId("")).toBe(false);
  expect(isEventId(undefined)).toBe(false);
  expect(isEventId(null)).toBe(false);
  // A Postgrest .or() filter is spliced into SQL, so this guard is the thing
  // standing between the user id and injection.
  expect(isEventId("'; drop table events; --")).toBe(false);
});

const EVENT_COLUMNS = [
  "id", "name", "start_time", "end_time", "status",
  "enrolled_attendees", "expected_attendance",
];

test("EVENT_FIELDS is a string, because postgrest-js select() is string-only", () => {
  // This is the regression that made every managed-events request a 500.
  // postgrest-js does `(columns ?? "*").split("")`, so handing it an array threw
  // "split is not a function" inside select(), before the request was sent.
  expect(typeof EVENT_FIELDS).toBe("string");
});

test("EVENT_FIELDS names exactly the columns the response needs, and nothing identifying", () => {
  expect(EVENT_FIELDS.split(",").map((column) => column.trim())).toEqual(EVENT_COLUMNS);
  for (const field of EVENT_COLUMNS) {
    // enrolled_attendees is a counter on the event, not a person. What must
    // never be selected is the *_id ownership columns or submitted form data.
    expect(field).not.toMatch(
      /^(attendee_id|organiser_id|coordinator_id|registration_data|description|purpose|venue_requirements|accessibility_needs|equipment_needs|other_comments)$/,
    );
  }
});

test("toListItem carries the counts the list renders", () => {
  expect(toListItem(EVENT)).toEqual({
    id: EVENT.id,
    name: "Annual Alumni Gala",
    start_time: "2026-10-02T01:00:00Z",
    status: "APPROVED",
    enrolled: 42,
    maxEnrollment: 120,
  });
});

test("a null enrolled_attendees reads as 0 registrations", () => {
  expect(toListItem({ ...EVENT, enrolled_attendees: null }).enrolled).toBe(0);
  expect(toListItem({ ...EVENT, enrolled_attendees: undefined }).enrolled).toBe(0);
});

test("a null expected_attendance stays null so the UI can show a dash", () => {
  // Not 0: expected_attendance is the organiser's expected headcount, and null
  // means "never stated", which is not the same claim as a capacity of zero.
  expect(toListItem({ ...EVENT, expected_attendance: null }).maxEnrollment).toBeNull();
  expect(toListItem({ ...EVENT, expected_attendance: 0 }).maxEnrollment).toBe(0);
});

test("a negative or non-integer count is not trusted", () => {
  expect(toListItem({ ...EVENT, enrolled_attendees: -5 }).enrolled).toBe(0);
  expect(toListItem({ ...EVENT, expected_attendance: -5 }).maxEnrollment).toBeNull();
  expect(toListItem({ ...EVENT, enrolled_attendees: "12" }).enrolled).toBe(0);
});

test("toSummary adds end_time and the waiting list count to the list shape", () => {
  expect(toSummary(EVENT, 7)).toEqual({
    id: EVENT.id,
    name: "Annual Alumni Gala",
    start_time: "2026-10-02T01:00:00Z",
    end_time: "2026-10-02T05:00:00Z",
    status: "APPROVED",
    enrolled: 42,
    maxEnrollment: 120,
    waitingList: 7,
  });
});

test("a null waiting list count reads as 0", () => {
  // head:true returns a null count when Postgres cannot produce one.
  expect(toSummary(EVENT, null).waitingList).toBe(0);
});

test("a missing end_time becomes null rather than undefined", () => {
  expect(toSummary({ ...EVENT, end_time: undefined }, 0).end_time).toBeNull();
});
