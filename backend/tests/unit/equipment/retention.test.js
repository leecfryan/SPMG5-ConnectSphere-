const { test } = require("node:test");
const assert = require("node:assert/strict");

const { computeEventOverAt, isMessageExpired } = require("../../../src/modules/equipment/retention");

const DAY_MS = 24 * 60 * 60 * 1000;

test("computeEventOverAt: end_time is used when present", () => {
  const end = "2026-01-10T18:00:00.000Z";
  const overAt = computeEventOverAt({ start_time: "2026-01-10T14:00:00.000Z", end_time: end });
  assert.equal(overAt.toISOString(), new Date(end).toISOString());
});

test("computeEventOverAt: falls back to start_time + 1 day when end_time is absent", () => {
  const start = "2026-01-10T14:00:00.000Z";
  const overAt = computeEventOverAt({ start_time: start, end_time: null });
  assert.equal(overAt.getTime(), new Date(start).getTime() + DAY_MS);
});

test("computeEventOverAt: null when the event has no schedule at all", () => {
  assert.equal(computeEventOverAt({ start_time: null, end_time: null }), null);
});

test("isMessageExpired: false while the event has no computable end", () => {
  assert.equal(isMessageExpired({ start_time: null, end_time: null }), false);
});

test("isMessageExpired: false right up to the 30-day boundary", () => {
  const end = "2026-01-01T00:00:00.000Z";
  const now = new Date(new Date(end).getTime() + 30 * DAY_MS);
  assert.equal(isMessageExpired({ end_time: end }, now), false);
});

test("isMessageExpired: true just past the 30-day boundary", () => {
  const end = "2026-01-01T00:00:00.000Z";
  const now = new Date(new Date(end).getTime() + 30 * DAY_MS + 1);
  assert.equal(isMessageExpired({ end_time: end }, now), true);
});

test("isMessageExpired: false well before the event is even over", () => {
  const end = "2026-06-01T00:00:00.000Z";
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(isMessageExpired({ end_time: end }, now), false);
});
