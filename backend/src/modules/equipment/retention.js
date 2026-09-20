// Scrum-28-Scrum65 (AC3) retention rule: "event over" = event.end_at if
// present, else event.date + 1 day; messages are retained until 30 days
// after that. Pure and DB-free (same reasoning as equipment.validation.js
// for testability) - real Supabase events don't have end_at/date columns,
// they have start_time/end_time (both nullable), so those are the fields
// actually read here.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * ONE_DAY_MS;

// Returns null when the event has no schedule at all (both start_time and
// end_time absent - both are nullable in the real schema) - callers treat
// that as "not over yet," never as an error.
function computeEventOverAt(event) {
  if (event.end_time) return new Date(event.end_time);
  if (event.start_time) return new Date(new Date(event.start_time).getTime() + ONE_DAY_MS);
  return null;
}

function isMessageExpired(event, now = new Date()) {
  const overAt = computeEventOverAt(event);
  if (!overAt) return false;
  return now.getTime() > overAt.getTime() + RETENTION_MS;
}

module.exports = { computeEventOverAt, isMessageExpired };
