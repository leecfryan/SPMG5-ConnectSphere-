import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const makeVenues = require("../../../../tests/playwright/support/venue-storage.cjs");
const makeData = require("../../../../tests/playwright/support/registration-storage.cjs");
const makeNotifications = require("../../../../tests/playwright/support/venue-hold-notification-storage.cjs");
const venueId = "11111111-1111-4111-8111-111111111111";
const base = Date.parse("2030-01-01T00:00:00Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(base); });
afterEach(() => { vi.useRealTimers(); });
function fixture() {
  const event = { id: "event-a", name: "Saved event", coordinator_id: "coordinator-a", status: "APPROVED", start_time: "2099-01-01T00:00:00Z", end_time: "2099-01-01T15:00:00Z" };
  const accounts = new Map([["organiser", { events: [event] }]]);
  const venues = makeVenues(accounts), data = makeData(accounts), pending = new Map();
  let clock;
  const work = makeNotifications(venues, data, pending, { post: (_path, handler) => { clock = handler; } });
  const time = (owner, instant) => clock({ params: { coordinatorId: owner }, body: { now: new Date(instant).toISOString() } }, { sendStatus: vi.fn() });
  const hold = (owner = "coordinator-a", slots = ["am", "pm", "night"]) => venues.createHold(venueId, {
    event_id: event.id, event_name: "FORGED client display", coordinator_id: owner, booking_date: "2099-01-01", slots, expires_at: new Date(base + 3600000).toISOString(),
  }, "venue-staff");
  return { venues, work, pending, time, hold };
}
test("[TC-SCRUM-163-D01] Storage double groups slots, uses canonical names and retains deduplication after outbox removal", async () => {
  const f = fixture();
  await f.hold();
  expect(await f.work.prepareVenueHolds()).toBe(1);
  const [notice] = f.pending.values();
  expect(notice.recipient_id).toBe("coordinator-a");
  expect(notice.payload.stateIds).toHaveLength(3);
  expect(notice.payload.message).toBe("Your tentative hold at Integration Hall for Saved event on 2099-01-01 expires at 2030-01-01 01:00:00 UTC. Open venue availability to review it.");
  expect(await f.work.prepareVenueHolds()).toBe(0);
  f.pending.clear();
  expect(await f.work.prepareVenueHolds()).toBe(0);
});
test("[TC-SCRUM-163-D02] Fixed-clock boundary controls advance both notifications and actual stored-hold availability", async () => {
  const f = fixture();
  await f.hold();
  f.time("coordinator-a", base - 1);
  expect(await f.work.prepareVenueHolds()).toBe(0);
  f.time("coordinator-a", base);
  expect(await f.work.prepareVenueHolds()).toBe(1);
  const [warning] = f.pending.values();
  expect(await f.work.venueHoldNotificationIsCurrent(warning)).toBe(true);
  f.time("coordinator-a", base + 3600000);
  expect(await f.work.venueHoldNotificationIsCurrent(warning)).toBe(false);
  expect(await f.venues.listActiveHoldsInRange(venueId, "2099-01-01", "2099-01-01")).toEqual([]);
  expect(await f.venues.listHolds(venueId)).toHaveLength(3);
  expect(await f.work.prepareVenueHolds()).toBe(1);
  const expiry = [...f.pending.values()].find(row => row.payload.changeType === "expired");
  expect(await f.work.venueHoldNotificationIsCurrent(expiry)).toBe(true);
});
test("[TC-SCRUM-163-D03] Confirmed conversion ends the hold and suppresses a later false expiry", async () => {
  const f = fixture();
  const holds = await f.hold();
  await f.work.prepareVenueHolds();
  const [warning] = f.pending.values();
  const id = await f.venues.submitBookingRequest(venueId, "Saved event", { event_id: "event-a", booking_date: "2099-01-01", slots: ["am", "pm", "night"] }, "coordinator-a");
  await f.venues.linkHoldsToRequest(holds.map(row => row.id), id);
  await f.venues.decideBookingRequest(id, "confirmed");
  expect(await f.work.venueHoldNotificationIsCurrent(warning)).toBe(false);
  f.time("coordinator-a", base + 3600001);
  expect(await f.work.prepareVenueHolds()).toBe(0);
  expect([...f.pending.values()].some(row => row.payload.changeType === "expired")).toBe(false);
  expect(await f.venues.listHolds(venueId)).toEqual([]);
});
test("[TC-SCRUM-163-D04] Test clock overrides and concurrent preparations do not leak across coordinator fixtures", async () => {
  const f = fixture();
  await f.hold("coordinator-a"); await f.hold("coordinator-b");
  f.time("coordinator-a", base + 3600001);
  await Promise.all([f.work.prepareVenueHolds(), f.work.prepareVenueHolds()]);
  const notices = [...f.pending.values()];
  expect(notices).toHaveLength(2);
  expect(notices.find(row => row.recipient_id === "coordinator-a").payload.changeType).toBe("expired");
  expect(notices.find(row => row.recipient_id === "coordinator-b").payload.changeType).toBe("expiring");
  expect(await f.work.venueHoldNotificationIsCurrent({ ...notices[0], recipient_id: "unrelated" })).toBe(false);
});
