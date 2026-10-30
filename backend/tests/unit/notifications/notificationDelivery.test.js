import { test, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createNotificationDeliveryService } = require("../../../src/modules/notifications/notificationDelivery.service");
const { createNotificationOutboxRepository } = require("../../../src/modules/notifications/notificationOutbox.repository");
const row = { id: "delivery-id", recipient_id: "organiser", lease_token: "lease-one", payload: { eventName: "Literacy", outcome: "approved" } };
function fixture() {
  const repository = { prepareVenueHolds: async () => 0, prepareRegistrations: async () => 0, prepareReminders: async () => 0, prepareAssignments: vi.fn(async () => 0), claim: vi.fn(async () => [row]), complete: vi.fn(async () => true), retry: vi.fn(async () => true) };
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
  const first = f.service.runOnce();
  await vi.waitFor(() => expect(f.repository.claim).toHaveBeenCalledTimes(1));
  await f.service.runOnce(); expect(f.repository.claim).toHaveBeenCalledTimes(1);
  release([row]); await first; await f.service.runOnce(); expect(f.repository.claim).toHaveBeenCalledTimes(2);
});
test("[TC-SCRUM-143-25] Repository uses fenced claim/finish RPCs and normalises storage errors", async () => {
  const abortSignal = vi.fn(async () => ({ data: [row], error: null }));
  const client = { rpc: vi.fn(() => ({ abortSignal })) };
  const repository = createNotificationOutboxRepository(client);
  await repository.prepareAssignments();
  expect(await repository.claim()).toEqual([row]);
  await repository.complete(row); await repository.retry(row);
  expect(client.rpc.mock.calls).toEqual([
    ["enqueue_assignment_notifications", {}],
    ["claim_notification_outbox", {}],
    ["finish_notification_outbox", { delivery_id: row.id, claim_token: "lease-one", succeeded: true }],
    ["finish_notification_outbox", { delivery_id: row.id, claim_token: "lease-one", succeeded: false }],
  ]);
  expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  abortSignal.mockResolvedValue({ data: null, error: { message: "PRIVATE db" } });
  await expect(repository.claim()).rejects.toThrow("Notification queue is unavailable.");
});


test("[TC-SCRUM-155-U03] Preparation makes both reassignment notices deliverable with their own recipient and saved attribution", async () => {
  const f = fixture(); let pending = [];
  const payload = { eventId: "event-1", eventName: "Saved event", assignedById: "lead", assignedByName: "Ada Lead", assignmentChangeId: "change-1" };
  const deliveries = [
    { ...row, id: "incoming-delivery", workflow: "event-assignment", recipient_id: "incoming", payload: { ...payload, assignmentType: "reassigned" } },
    { ...row, id: "outgoing-delivery", workflow: "event-assignment", recipient_id: "outgoing", payload: { ...payload, assignmentType: "reassigned-away" } },
  ];
  f.repository.prepareAssignments.mockImplementation(async () => { pending = deliveries; });
  f.repository.claim.mockImplementation(async () => pending);
  f.fetchImpl.mockImplementation(async (_url, args) => ({ ok: true, json: async () => ({ acknowledged: true, status: "processed", transactionId: JSON.parse(args.body).transactionId }) }));
  await f.service.runOnce();
  expect(f.fetchImpl.mock.calls.map(([, args]) => JSON.parse(args.body))).toEqual(deliveries.map(delivery => ({
    name: "event-assignment", to: { subscriberId: delivery.recipient_id }, transactionId: delivery.id, payload: delivery.payload,
  })));
  expect(f.repository.complete.mock.calls.map(([delivery]) => delivery.id)).toEqual(["incoming-delivery", "outgoing-delivery"]);
  expect(f.repository.retry).not.toHaveBeenCalled();
});

test("[TC-SCRUM-155-U04] Preparation failure does not block existing decision notifications", async () => {
  const f = fixture(); f.repository.prepareAssignments.mockRejectedValueOnce(new Error("history unavailable"));
  await f.service.runOnce();
  expect(f.repository.prepareAssignments).toHaveBeenCalledTimes(1);
  expect(f.repository.complete).toHaveBeenCalledWith(row);
  expect(f.logger.warn).toHaveBeenCalledTimes(1);
});

test("[TC-SCRUM-155-U05] One failed reassignment recipient retries with the same delivery identity while the other completes", async () => {
  const f = fixture();
  const incoming = { ...row, workflow: "event-assignment", id: "incoming", recipient_id: "coordinator-b", payload: { eventName: "Literacy", assignedByName: "Ada Lead", assignmentType: "reassigned" } };
  const outgoing = { ...incoming, id: "outgoing", recipient_id: "coordinator-a", payload: { ...incoming.payload, assignmentType: "reassigned-away" } };
  f.repository.claim.mockResolvedValueOnce([incoming, outgoing]).mockResolvedValueOnce([incoming]);
  f.fetchImpl.mockImplementationOnce(async () => ({ ok: false, status: 503 }))
    .mockImplementation(async (_url, args) => ({ ok: true, json: async () => ({ acknowledged: true, status: "processed", transactionId: JSON.parse(args.body).transactionId }) }));
  await f.service.runOnce();
  expect(f.repository.retry).toHaveBeenCalledExactlyOnceWith(incoming);
  expect(f.repository.complete).toHaveBeenCalledExactlyOnceWith(outgoing);
  await f.service.runOnce();
  expect(f.repository.complete).toHaveBeenLastCalledWith(incoming);
  expect(f.fetchImpl.mock.calls[0][1].body).toBe(f.fetchImpl.mock.calls[2][1].body);
  expect(f.fetchImpl.mock.calls[0][1].headers["Idempotency-Key"]).toBe("incoming");
  expect(f.fetchImpl.mock.calls[2][1].headers["Idempotency-Key"]).toBe("incoming");
});

test("[TC-SCRUM-43-U01] Registration and reminder preparation are independent of each other and existing delivery", async () => {
  const f = fixture();
  f.repository.prepareRegistrations = vi.fn().mockRejectedValueOnce(new Error("private history"));
  f.repository.prepareReminders = vi.fn().mockRejectedValueOnce(new Error("private reminders"));
  await f.service.runOnce();
  expect(f.repository.prepareRegistrations).toHaveBeenCalledTimes(1);
  expect(f.repository.prepareReminders).toHaveBeenCalledTimes(1);
  expect(f.repository.complete).toHaveBeenCalledWith(row);
  expect(f.logger.warn).toHaveBeenCalledTimes(2);
});

test.each([true, false])("[TC-SCRUM-43-U02] Reminder sends only when its current offer validates as %s", async current => {
  const f = fixture();
  const reminder = { ...row, workflow: "waitlist-offer-expiring" };
  f.repository.claim.mockResolvedValue([reminder]);
  f.repository.reminderIsCurrent = vi.fn(async () => current);
  await f.service.runOnce();
  expect(f.repository.reminderIsCurrent).toHaveBeenCalledExactlyOnceWith(reminder);
  expect(f.fetchImpl).toHaveBeenCalledTimes(current ? 1 : 0);
  expect(f.repository.complete).toHaveBeenCalledWith(reminder);
  expect(f.repository.retry).not.toHaveBeenCalled();
});

test("[TC-SCRUM-43-U03] Validation failure retains a reminder for retry without sending it", async () => {
  const f = fixture();
  const reminder = { ...row, workflow: "waitlist-offer-expiring" };
  f.repository.claim.mockResolvedValue([reminder]);
  f.repository.reminderIsCurrent = vi.fn().mockRejectedValueOnce(new Error("private storage failure"));
  await f.service.runOnce();
  expect(f.fetchImpl).not.toHaveBeenCalled();
  expect(f.repository.complete).not.toHaveBeenCalled();
  expect(f.repository.retry).toHaveBeenCalledWith(reminder);
});

test("[TC-SCRUM-43-U04] Registration RPCs use the delivery lease and reject malformed validity responses", async () => {
  const abortSignal = vi.fn(async () => ({ data: true, error: null }));
  const client = { rpc: vi.fn(() => ({ abortSignal })) };
  const repository = createNotificationOutboxRepository(client);
  await repository.prepareRegistrations();
  await repository.prepareReminders();
  expect(await repository.reminderIsCurrent(row)).toBe(true);
  expect(client.rpc.mock.calls).toEqual([
    ["enqueue_registration_notifications", {}],
    ["enqueue_waitlist_offer_reminders", {}],
    ["validate_waitlist_offer_reminder", { delivery_id: row.id, claim_token: row.lease_token }],
  ]);
  abortSignal.mockResolvedValue({ data: null, error: null });
  await expect(repository.reminderIsCurrent(row)).rejects.toThrow("Notification queue is unavailable.");
});

test("[TC-SCRUM-43-U05] A failed retry write does not strand other claimed notifications", async () => {
  const f = fixture();
  const failed = { ...row, id: "provider-down", workflow: "registration-status" };
  const healthy = { ...row, id: "healthy-reminder", workflow: "waitlist-offer-expiring" };
  f.repository.claim.mockResolvedValue([failed, healthy]);
  f.repository.retry.mockRejectedValueOnce(new Error("private retry storage failure"));
  f.repository.reminderIsCurrent = vi.fn(async () => true);
  f.fetchImpl.mockImplementationOnce(async () => ({ ok: false, status: 503 }))
    .mockImplementation(async (_url, args) => ({ ok: true, json: async () => ({
      acknowledged: true, status: "processed", transactionId: JSON.parse(args.body).transactionId,
    }) }));
  await f.service.runOnce();
  expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  expect(f.repository.retry).toHaveBeenCalledExactlyOnceWith(failed);
  expect(f.repository.complete).toHaveBeenCalledExactlyOnceWith(healthy);
  expect(f.repository.reminderIsCurrent).toHaveBeenCalledExactlyOnceWith(healthy);
});
