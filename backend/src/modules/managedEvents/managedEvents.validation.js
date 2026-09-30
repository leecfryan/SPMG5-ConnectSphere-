// Pure helpers for the managed-events module: the :eventId guard and the two
// response shapes. No express and no Supabase import, so these run in unit
// tests without credentials (same reasoning as venues.validation.js).

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only what the browser renders. Nothing here identifies an attendee, so the
// response cannot carry PII even if the query is widened by mistake.
//
// A comma-separated STRING, not an array. postgrest-js implements select() as
// `(columns ?? "*").split("")`, so an array throws "split is not a function"
// synchronously, before any request is sent, and surfaces as a 500 rather than
// a query error. Same convention as equipment.dependencies.js.
const EVENT_FIELDS =
  "id, name, start_time, end_time, status, enrolled_attendees, expected_attendance";

function isEventId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// enrolled_attendees is nullable in the live schema, and rows written before the
// column existed are still null today. Null is reported as 0 registrations:
// that is the number the user would otherwise read on a dashboard, and null
// would render as an empty cell beside a "/".
function toCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

// expected_attendance is nullable too, and it is the organiser's expected
// headcount rather than a hard capacity. Null is kept as null so the UI can
// show "-" and tell "no expectation stated" apart from a real zero.
function toLimit(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

// Shaped here rather than in the controller so the response contract lives in
// one file a test can check without express.
function toListItem(event) {
  return {
    id: event.id,
    name: event.name,
    start_time: event.start_time ?? null,
    status: event.status,
    enrolled: toCount(event.enrolled_attendees),
    maxEnrollment: toLimit(event.expected_attendance),
  };
}

function toSummary(event, waitingListCount) {
  return {
    ...toListItem(event),
    end_time: event.end_time ?? null,
    waitingList: toCount(waitingListCount),
  };
}

module.exports = {
  UUID_PATTERN,
  EVENT_FIELDS,
  isEventId,
  toListItem,
  toSummary,
};
