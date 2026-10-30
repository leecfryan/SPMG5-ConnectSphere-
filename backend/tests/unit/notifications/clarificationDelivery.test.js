import { test, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createNotificationDeliveryService } = require("../../../src/modules/notifications/notificationDelivery.service");

function fixture(workflow = "event-changes-requested") {
  const row = { id: "cycle-one", lease_token: "lease-one", recipient_id: "saved-owner", workflow,
    payload: { eventId: "saved-event", cycleId: "cycle-one", eventName: "Community <Workshop>",
      message: "Clarify layout & attendance.\nKeep this second line.", requestPath: "/my-event-requests/saved-event" } };
  const pending = new Map([[row.id, row]]);
  const repository = { prepareRegistrations: async () => 0, prepareReminders: async () => 0, prepareAssignments: vi.fn(async () => 0), claim: async () => [...pending.values()],
    complete: vi.fn(async row => pending.delete(row.id)), retry: vi.fn(async () => {}) };
  const fetchImpl = vi.fn(async (_url, args) => ({ ok: true, json: async () => ({ data: {
    acknowledged: true, status: "processed", transactionId: JSON.parse(args.body).transactionId } }) }));
  const service = createNotificationDeliveryService({ repository, secretKey: "local-only", fetchImpl, logger: { warn: vi.fn() } });
  return { row, pending, repository, fetchImpl, service };
}

test("[SCRUM-117-N01] saved owner, message and path are delivered with the cycle identity", async () => {
  const f = fixture(); await f.service.runOnce();
  const args = f.fetchImpl.mock.calls[0][1];
  expect(JSON.parse(args.body)).toEqual({ name: "event-changes-requested", to: { subscriberId: "saved-owner" }, transactionId: "cycle-one", payload: f.row.payload });
  expect(args.headers["Idempotency-Key"]).toBe("cycle-one");
  expect(f.pending.size).toBe(0);
  await f.service.runOnce(); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});

test.each(["event-changes-requested", "event-request-resubmitted"])("[SCRUM-117-N02-%s] failed delivery stays pending and retries the identical notice", async workflow => {
  const f = fixture(workflow); f.fetchImpl.mockResolvedValueOnce({ ok: false });
  await f.service.runOnce(); expect(f.pending.size).toBe(1);
  expect(f.repository.complete).not.toHaveBeenCalled(); expect(f.repository.retry).toHaveBeenCalledWith(f.row);
  await f.service.runOnce();
  expect(f.fetchImpl.mock.calls[1][1].body).toBe(f.fetchImpl.mock.calls[0][1].body);
  expect(f.fetchImpl.mock.calls[1][1].headers).toEqual(f.fetchImpl.mock.calls[0][1].headers);
  expect(f.pending.size).toBe(0);
});

test("[SCRUM-117-N03] two return cycles of one event have independent notifications", async () => {
  const f = fixture(); await f.service.runOnce();
  f.pending.set("cycle-two", { ...f.row, id: "cycle-two", payload: { ...f.row.payload, cycleId: "cycle-two", message: "Now clarify equipment." } });
  await f.service.runOnce();
  const bodies = f.fetchImpl.mock.calls.map(([,args]) => JSON.parse(args.body));
  expect(bodies.map(body => body.transactionId)).toEqual(["cycle-one", "cycle-two"]);
  expect(bodies.map(body => body.payload.message)).toEqual([f.row.payload.message, "Now clarify equipment."]);
  expect(f.pending.size).toBe(0);
});
