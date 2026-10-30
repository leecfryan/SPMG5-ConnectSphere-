import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createNotificationDeliveryService } = require("../../../src/modules/notifications/notificationDelivery.service");
const { createNotificationOutboxRepository } = require("../../../src/modules/notifications/notificationOutbox.repository");
const row = { id: "hold-delivery", recipient_id: "saved-coordinator", lease_token: "current-lease", workflow: "venue-hold-expiry",
  payload: { venueName: "Marina Hall", eventName: "Community Open Day", expiresAt: "2030-01-01T01:00:00Z", changeType: "expiring" } };
function fixture(current = true) {
  const repository = { prepareRegistrations: vi.fn(async () => 0), prepareReminders: vi.fn(async () => 0), prepareAssignments: vi.fn(async () => 0), prepareVenueHolds: vi.fn(async () => 0),
    venueHoldNotificationIsCurrent: vi.fn(async () => current), claim: vi.fn(async () => [row]),
    complete: vi.fn(async () => true), retry: vi.fn(async () => true) };
  const fetchImpl = vi.fn(async (_url, options) => ({ ok: true, json: async () => ({ data: {
    acknowledged: true, status: "processed", transactionId: JSON.parse(options.body).transactionId,
  } }) }));
  const logger = { warn: vi.fn() };
  return { repository, fetchImpl, logger, service: createNotificationDeliveryService({ repository, fetchImpl, logger, secretKey: "local-fixture-only" }) };
}
afterEach(() => { vi.useRealTimers(); });

for (const current of [true, false]) {
  test("[TC-SCRUM-163-U01-" + (current ? "current" : "obsolete") + "] Venue hold notice sends only when storage validity is " + current, async () => {
    const f = fixture(current);
    await f.service.runOnce();
    expect(f.repository.venueHoldNotificationIsCurrent).toHaveBeenCalledExactlyOnceWith(row);
    expect(f.fetchImpl).toHaveBeenCalledTimes(current ? 1 : 0);
    expect(f.repository.complete).toHaveBeenCalledExactlyOnceWith(row);
    expect(f.repository.retry).not.toHaveBeenCalled();
    expect(f.logger.warn).not.toHaveBeenCalled();
    if (current) expect(JSON.parse(f.fetchImpl.mock.calls[0][1].body)).toEqual({ name: "venue-hold-expiry", to: { subscriberId: row.recipient_id }, transactionId: row.id, payload: row.payload });
  });
}
test("[TC-SCRUM-163-U02] Missing live validity retains unsent work and never guesses eligibility", async () => {
  const f = fixture();
  f.repository.venueHoldNotificationIsCurrent.mockRejectedValueOnce(new Error("private storage failure"));
  await f.service.runOnce();
  expect(f.fetchImpl).not.toHaveBeenCalled();
  expect(f.repository.complete).not.toHaveBeenCalled();
  expect(f.repository.retry).toHaveBeenCalledExactlyOnceWith(row);
});
for (const failing of ["prepareAssignments", "prepareRegistrations", "prepareReminders", "prepareVenueHolds"]) {
  test("[TC-SCRUM-163-U03-" + failing + "] Preparation failure " + failing + " does not block existing deliveries", async () => {
    const f = fixture();
    f.repository[failing].mockRejectedValueOnce(new Error("private preparation failure"));
    const existing = { ...row, workflow: "event-decision" };
    f.repository.claim.mockResolvedValueOnce([existing]);
    await f.service.runOnce();
    expect(f.repository.prepareAssignments).toHaveBeenCalledOnce();
    expect(f.repository.prepareRegistrations).toHaveBeenCalledOnce();
    expect(f.repository.prepareReminders).toHaveBeenCalledOnce();
    expect(f.repository.prepareVenueHolds).toHaveBeenCalledOnce();
    expect(f.repository.complete).toHaveBeenCalledExactlyOnceWith(existing);
    expect(f.logger.warn).toHaveBeenCalledOnce();
  });
}
test("[TC-SCRUM-163-U04] A failed retry write cannot strand a healthy hold notice later in the claimed batch", async () => {
  const f = fixture();
  const failed = { ...row, id: "provider-failure", workflow: "event-decision" };
  f.repository.claim.mockResolvedValueOnce([failed, row]);
  f.fetchImpl.mockRejectedValueOnce(new Error("private provider failure"));
  f.repository.retry.mockRejectedValueOnce(new Error("private retry storage failure"));
  await f.service.runOnce();
  expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  expect(f.repository.complete).toHaveBeenCalledExactlyOnceWith(row);
  expect(f.repository.retry).toHaveBeenCalledExactlyOnceWith(failed);
});
test("[TC-SCRUM-163-U05] RPC adapter binds the saved delivery lease and rejects non-boolean validity", async () => {
  const abortSignal = vi.fn(async () => ({ data: true, error: null }));
  const client = { rpc: vi.fn(() => ({ abortSignal })) };
  const repository = createNotificationOutboxRepository(client);
  await repository.prepareVenueHolds();
  expect(await repository.venueHoldNotificationIsCurrent(row)).toBe(true);
  expect(client.rpc.mock.calls).toEqual([["enqueue_venue_hold_notifications", {}], ["validate_venue_hold_notification", { delivery_id: row.id, claim_token: row.lease_token }]]);
  for (const invalid of [null, undefined, "true", {}, []]) {
    abortSignal.mockResolvedValueOnce({ data: invalid, error: null });
    await expect(repository.venueHoldNotificationIsCurrent(row)).rejects.toThrow("Notification queue is unavailable.");
  }
  abortSignal.mockResolvedValueOnce({ data: null, error: { message: "private SQL detail" } });
  await expect(repository.prepareVenueHolds()).rejects.toThrow("Notification queue is unavailable.");
});

// SCRUM-43/SCRUM-163: a shared claimed batch must retain each family's routing and validity contract.
function mixedFixture() {
  const rows = [
    { id: "venue", recipient_id: "hold-coordinator", workflow: "venue-hold-expiry", payload: { message: "Venue hold expires at 2030-01-01 01:00:00 UTC." } },
    { id: "registration", recipient_id: "registered-attendee", workflow: "registration-status", payload: { message: "Your registration is confirmed." } },
    { id: "reminder", recipient_id: "offered-attendee", workflow: "waitlist-offer-expiring", payload: { message: "Your place offer expires at 2030-01-01 01:00:00 UTC." } },
    { id: "assignment", recipient_id: "assigned-coordinator", workflow: "event-assignment", payload: { eventName: "Assigned event" } },
    { id: "decision", recipient_id: "organiser", workflow: "event-decision", payload: { eventName: "Approved event", outcome: "approved" } },
  ].map(item => ({ ...item, lease_token: "lease-" + item.id }));
  const repository = { prepareAssignments: vi.fn(async () => 0), prepareRegistrations: vi.fn(async () => 0),
    prepareReminders: vi.fn(async () => 0), prepareVenueHolds: vi.fn(async () => 0),
    reminderIsCurrent: vi.fn(async () => true), venueHoldNotificationIsCurrent: vi.fn(async () => true),
    claim: vi.fn(async () => rows), complete: vi.fn(async () => true), retry: vi.fn(async () => true) };
  const fetchImpl = vi.fn(async (_url, options) => ({ ok: true, json: async () => ({ data: {
    acknowledged: true, status: "processed", transactionId: JSON.parse(options.body).transactionId,
  } }) }));
  const logger = { warn: vi.fn() };
  const service = createNotificationDeliveryService({ repository, fetchImpl, logger, secretKey: "local-fixture-only" });
  return { rows, repository, fetchImpl, logger, service };
}

test("[TC-SCRUM-163-U06] A mixed claimed batch preserves registration, reminder, venue, assignment and decision recipients", async () => {
  const f = mixedFixture();
  await f.service.runOnce();
  for (const method of ["prepareAssignments", "prepareRegistrations", "prepareReminders", "prepareVenueHolds"]) {
    expect(f.repository[method]).toHaveBeenCalledOnce();
  }
  expect(f.fetchImpl.mock.calls.map(([, args]) => JSON.parse(args.body))).toEqual([
    { name: "venue-hold-expiry", to: { subscriberId: "hold-coordinator" }, transactionId: "venue", payload: { message: "Venue hold expires at 2030-01-01 01:00:00 UTC." } },
    { name: "registration-status", to: { subscriberId: "registered-attendee" }, transactionId: "registration", payload: { message: "Your registration is confirmed." } },
    { name: "waitlist-offer-expiring", to: { subscriberId: "offered-attendee" }, transactionId: "reminder", payload: { message: "Your place offer expires at 2030-01-01 01:00:00 UTC." } },
    { name: "event-assignment", to: { subscriberId: "assigned-coordinator" }, transactionId: "assignment", payload: { eventName: "Assigned event" } },
    { name: "event-decision", to: { subscriberId: "organiser" }, transactionId: "decision", payload: { eventName: "Approved event", outcome: "approved" } },
  ]);
  expect(f.repository.venueHoldNotificationIsCurrent).toHaveBeenCalledExactlyOnceWith(f.rows[0]);
  expect(f.repository.reminderIsCurrent).toHaveBeenCalledExactlyOnceWith(f.rows[2]);
  expect(f.repository.complete.mock.calls.map(([item]) => item.id)).toEqual(["venue", "registration", "reminder", "assignment", "decision"]);
  expect(f.repository.retry).not.toHaveBeenCalled();
  expect(f.logger.warn).not.toHaveBeenCalled();
});

test("[TC-SCRUM-163-U07] Obsolete venue and offer notices are dropped independently while other workflow families are delivered", async () => {
  const f = mixedFixture();
  f.repository.venueHoldNotificationIsCurrent.mockResolvedValue(false);
  f.repository.reminderIsCurrent.mockResolvedValue(false);
  await f.service.runOnce();
  expect(f.fetchImpl.mock.calls.map(([, args]) => JSON.parse(args.body).name)).toEqual(["registration-status", "event-assignment", "event-decision"]);
  expect(f.repository.complete.mock.calls.map(([item]) => item.id)).toEqual(["venue", "registration", "reminder", "assignment", "decision"]);
  expect(f.repository.retry).not.toHaveBeenCalled();
  expect(f.logger.warn).not.toHaveBeenCalled();
});

for (const [method, failedId, expectedSent] of [
  ["venueHoldNotificationIsCurrent", "venue", ["registration", "reminder", "assignment", "decision"]],
  ["reminderIsCurrent", "reminder", ["venue", "registration", "assignment", "decision"]],
]) {
  test("[TC-SCRUM-163-U08-" + failedId + "] One family's validity outage retains its row without blocking other families", async () => {
    const f = mixedFixture();
    f.repository[method].mockRejectedValueOnce(new Error("private storage failure"));
    await f.service.runOnce();
    expect(f.fetchImpl.mock.calls.map(([, args]) => JSON.parse(args.body).transactionId)).toEqual(expectedSent);
    expect(f.repository.retry).toHaveBeenCalledExactlyOnceWith(f.rows.find(item => item.id === failedId));
    expect(f.repository.complete.mock.calls.map(([item]) => item.id)).toEqual(expectedSent);
    expect(f.logger.warn).toHaveBeenCalledOnce();
  });
}
