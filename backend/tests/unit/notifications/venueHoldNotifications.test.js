import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createNotificationDeliveryService } = require("../../../src/modules/notifications/notificationDelivery.service");
const { createNotificationOutboxRepository } = require("../../../src/modules/notifications/notificationOutbox.repository");
const row = { id: "hold-delivery", recipient_id: "saved-coordinator", lease_token: "current-lease", workflow: "venue-hold-expiry",
  payload: { venueName: "Marina Hall", eventName: "Community Open Day", expiresAt: "2030-01-01T01:00:00Z", changeType: "expiring" } };
function fixture(current = true) {
  const repository = { prepareAssignments: vi.fn(async () => 0), prepareVenueHolds: vi.fn(async () => 0),
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
for (const failing of ["prepareAssignments", "prepareVenueHolds"]) {
  test("[TC-SCRUM-163-U03-" + failing + "] Preparation failure " + failing + " does not block existing deliveries", async () => {
    const f = fixture();
    f.repository[failing].mockRejectedValueOnce(new Error("private preparation failure"));
    const existing = { ...row, workflow: "event-decision" };
    f.repository.claim.mockResolvedValueOnce([existing]);
    await f.service.runOnce();
    expect(f.repository.prepareAssignments).toHaveBeenCalledOnce();
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
