import { test, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createNotificationDeliveryService } = require("../../../src/modules/notifications/notificationDelivery.service");
const { createNotificationOutboxRepository } = require("../../../src/modules/notifications/notificationOutbox.repository");
const row = { id: "delivery-id", recipient_id: "organiser", lease_token: "lease-one", payload: { eventName: "Literacy", outcome: "approved" } };
function fixture() {
  const repository = { claim: vi.fn(async () => [row]), complete: vi.fn(async () => true), retry: vi.fn(async () => true) };
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: { acknowledged: true, status: "processed", transactionId: row.id } }) }));
  const logger = { warn: vi.fn() };
  return { repository, fetchImpl, logger, service: createNotificationDeliveryService({ repository, fetchImpl, logger, secretKey: "fixture-only-key" }) };
}
afterEach(() => { vi.useRealTimers(); });

test.each([undefined, "", "   "])("[TC-SCRUM-143-20] Missing key %j disables delivery without a network call", key => {
  expect(createNotificationDeliveryService({ repository: {}, secretKey: key })).toBeUndefined();
});
test("[TC-SCRUM-143-20] Missing data repository disables delivery", () => {
  expect(createNotificationDeliveryService({ secretKey: "dummy" })).toBeUndefined();
});
test("[TC-SCRUM-143-21] Accepted trigger uses persisted recipient, immutable payload, stable dedup IDs and bounded request", async () => {
  const f = fixture(); await f.service.runOnce();
  const [url, args] = f.fetchImpl.mock.calls[0];
  expect(url).toBe("https://api.novu.co/v1/events/trigger");
  expect(args).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: "ApiKey fixture-only-key", "Idempotency-Key": row.id } });
  expect(args.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(args.body)).toEqual({ name: "event-decision", to: { subscriberId: "organiser" }, transactionId: row.id, payload: row.payload });
  expect(f.repository.complete).toHaveBeenCalledWith(row);
  expect(f.repository.retry).not.toHaveBeenCalled();
});
test("[TC-SCRUM-143-21] Direct REST acknowledgement also completes delivery", async () => {
  const f = fixture(); f.fetchImpl.mockResolvedValue({ ok: true, json: async () => ({ acknowledged: true, status: "processed", transactionId: row.id }) });
  await f.service.runOnce(); expect(f.repository.complete).toHaveBeenCalledWith(row);
});
test.each([
  { acknowledged: false, status: "processed", transactionId: row.id },
  { acknowledged: true, status: "trigger_not_active", transactionId: row.id },
  { acknowledged: true, status: "processed", transactionId: "wrong-delivery" },
])("[TC-SCRUM-143-22] A 201 without a matching successful workflow result %j remains pending", async result => {
  const f = fixture(); f.fetchImpl.mockResolvedValue({ ok: true, json: async () => ({ data: result }) });
  await f.service.runOnce(); expect(f.repository.complete).not.toHaveBeenCalled(); expect(f.repository.retry).toHaveBeenCalledWith(row);
});
test.each([400, 401, 409, 422, 429, 503])("[TC-SCRUM-143-22] HTTP %i leaves work queued and logs no provider detail", async status => {
  const f = fixture(); f.fetchImpl.mockResolvedValue({ ok: false, status, json: async () => ({ secret: "PRIVATE detail" }) });
  await f.service.runOnce(); expect(f.repository.complete).not.toHaveBeenCalled(); expect(f.repository.retry).toHaveBeenCalledWith(row);
  expect(f.logger.warn).toHaveBeenCalledWith("Notification delivery is pending. Check the queue and Novu workflow configuration.");
});
test.each(["timeout", "invalid JSON"])("[TC-SCRUM-143-22] %s is recoverable", async mode => {
  const f = fixture();
  if (mode === "timeout") f.fetchImpl.mockRejectedValue(new Error("PRIVATE timeout"));
  else f.fetchImpl.mockResolvedValue({ ok: true, json: async () => { throw new Error("PRIVATE JSON"); } });
  await f.service.runOnce(); expect(f.repository.retry).toHaveBeenCalledWith(row);
});
test("[TC-SCRUM-143-23] Failed database acknowledgement replays the exact accepted trigger", async () => {
  const f = fixture(); f.repository.complete.mockRejectedValueOnce(new Error("PRIVATE db"));
  await f.service.runOnce(); await f.service.runOnce();
  expect(f.repository.retry).toHaveBeenCalledTimes(1);
  expect(f.fetchImpl.mock.calls[0][1].body).toBe(f.fetchImpl.mock.calls[1][1].body);
  expect(f.fetchImpl.mock.calls[0][1].headers).toEqual(f.fetchImpl.mock.calls[1][1].headers);
});
test("[TC-SCRUM-143-23] Worker recovers after claim and retry-storage failures", async () => {
  const f = fixture(); f.repository.claim.mockRejectedValueOnce(new Error("PRIVATE db"));
  await f.service.runOnce(); expect(f.fetchImpl).not.toHaveBeenCalled();
  f.fetchImpl.mockRejectedValueOnce(new Error("PRIVATE transport")); f.repository.retry.mockRejectedValueOnce(new Error("PRIVATE release"));
  await f.service.runOnce(); await f.service.runOnce(); expect(f.repository.complete).toHaveBeenCalledTimes(1);
});
test("[TC-SCRUM-143-24] Empty queue, start/stop and repeated start do not duplicate workers", async () => {
  vi.useFakeTimers(); const f = fixture(); f.repository.claim.mockResolvedValue([]);
  const stop = f.service.start(); f.service.start();
  await vi.advanceTimersByTimeAsync(15000); expect(f.repository.claim).toHaveBeenCalledTimes(2);
  stop(); await vi.advanceTimersByTimeAsync(30000); expect(f.repository.claim).toHaveBeenCalledTimes(2);
  f.service.start(); await vi.advanceTimersByTimeAsync(0); expect(f.repository.claim).toHaveBeenCalledTimes(3); f.service.stop();
});
test("[TC-SCRUM-143-24] A slow delivery skips overlapping polls", async () => {
  const f = fixture(); let release; f.repository.claim.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const first = f.service.runOnce(); await f.service.runOnce(); expect(f.repository.claim).toHaveBeenCalledTimes(1);
  release([row]); await first; await f.service.runOnce(); expect(f.repository.claim).toHaveBeenCalledTimes(2);
});
test("[TC-SCRUM-143-25] Repository uses fenced claim/finish RPCs and normalises storage errors", async () => {
  const abortSignal = vi.fn(async () => ({ data: [row], error: null }));
  const client = { rpc: vi.fn(() => ({ abortSignal })) };
  const repository = createNotificationOutboxRepository(client);
  expect(await repository.claim()).toEqual([row]);
  await repository.complete(row); await repository.retry(row);
  expect(client.rpc.mock.calls).toEqual([
    ["claim_notification_outbox", {}],
    ["finish_notification_outbox", { delivery_id: row.id, claim_token: "lease-one", succeeded: true }],
    ["finish_notification_outbox", { delivery_id: row.id, claim_token: "lease-one", succeeded: false }],
  ]);
  expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  abortSignal.mockResolvedValue({ data: null, error: { message: "PRIVATE db" } });
  await expect(repository.claim()).rejects.toThrow("Notification queue is unavailable.");
});
