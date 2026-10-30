import { test, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const { createNotificationDeliveryService } = require("../../src/modules/notifications/notificationDelivery.service");
const { createNotificationOutboxRepository } = require("../../src/modules/notifications/notificationOutbox.repository");

// SCRUM-43: transport contract only; real capture, leases and timing are exercised in PostgreSQL.
function acceptsRegistrationTrigger(trigger) {
  const p = trigger.payload;
  const reminder = trigger.name === "waitlist-offer-expiring";
  if (!["registration-status", "waitlist-offer-expiring"].includes(trigger.name) || !p) return false;
  const fields = ["eventId", "eventName", "changeType", "message", "requestPath", reminder ? "offerChangeId" : "changeId"];
  if (!fields.every(field => typeof p[field] === "string" && p[field].length > 0)) return false;
  if (!p.requestPath.startsWith("/") || p.requestPath.startsWith("//") || /\s/.test(p.requestPath)) return false;
  if (reminder || p.changeType === "promoted") return typeof p.effectiveDeadline === "string" && Number.isFinite(Date.parse(p.effectiveDeadline));
  return p.effectiveDeadline === null;
}
async function setup(t, rows) {
  let pending = [];
  let prepared = false;
  let outage = false;
  let current = true;
  const requests = [];
  const failures = new Set();
  const logger = { warn: vi.fn() };
  const provider = createServer(async (request, response) => {
    let body = "";
    for await (const part of request) body += part;
    const payload = JSON.parse(body);
    requests.push({ body: payload, id: request.headers["idempotency-key"] });
    response.setHeader("Content-Type", "application/json");
    const valid = acceptsRegistrationTrigger(payload);
    response.statusCode = outage ? 503 : valid ? 200 : 422;
    response.end(JSON.stringify({ acknowledged: !outage && valid, status: valid ? "processed" : "invalid_payload", transactionId: payload.transactionId }));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.onTestFinished(() => new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); }));
  const client = { rpc: vi.fn((name, args) => ({ abortSignal: async () => {
    if (failures.has(name)) return { data: null, error: { message: "PRIVATE fixture failure" } };
    if (name === "enqueue_registration_notifications") {
      if (prepared) return { data: 0, error: null };
      pending = structuredClone(rows); prepared = true;
      return { data: rows.length, error: null };
    }
    if (["enqueue_assignment_notifications", "enqueue_waitlist_offer_reminders", "enqueue_venue_hold_notifications"].includes(name)) return { data: 0, error: null };
    if (name === "claim_notification_outbox") return { data: structuredClone(pending), error: null };
    if (name === "validate_waitlist_offer_reminder") return { data: current, error: null };
    if (name === "finish_notification_outbox") {
      const matching = pending.find(row => row.id === args.delivery_id && row.lease_token === args.claim_token);
      if (matching && args.succeeded) pending = pending.filter(row => row !== matching);
      return { data: Boolean(matching), error: null };
    }
    throw new Error("Unexpected RPC: " + name);
  } })) };
  const repository = createNotificationOutboxRepository(client);
  const worker = () => createNotificationDeliveryService({ repository, secretKey: "local-test-only", logger,
    fetchImpl: (_url, args) => fetch("http://127.0.0.1:" + provider.address().port + "/trigger", args) });
  return { worker, requests, failures, logger, client, pending: () => pending,
    outage: value => { outage = value; }, current: value => { current = value; } };
}

function notice(id, recipient, changeType, message, workflow = "registration-status") {
  return { id, recipient_id: recipient, lease_token: "lease-" + id, workflow,
    payload: { eventId: "event-a", eventName: "Community Open Day", changeType, message, requestPath: "/registrations/me",
      ...(workflow === "waitlist-offer-expiring" ? { offerChangeId: "offer-" + id } : { changeId: id }),
      effectiveDeadline: workflow === "waitlist-offer-expiring" || changeType === "promoted" ? "2030-01-01T01:00:00Z" : null } };
}

test("[TC-SCRUM-43-I01] Saved confirmation, waitlist and promotion messages reach exactly their owning attendees", async t => {
  const rows = [
    notice("confirmed-a", "attendee-a", "confirmed", "Your registration for Community Open Day is confirmed."),
    notice("waitlisted-b", "attendee-b", "waitlisted", "You have joined the waitlist for Community Open Day."),
    notice("promoted-b", "attendee-b", "promoted", "A place is available for you at Community Open Day. Accept your offer by 2030-01-01 01:00:00 UTC."),
  ];
  const f = await setup(t, rows);
  await f.worker().runOnce();
  expect(f.requests).toEqual(rows.map(row => ({ id: row.id, body: {
    name: "registration-status", transactionId: row.id, to: { subscriberId: row.recipient_id }, payload: row.payload,
  } })));
  expect(f.pending()).toEqual([]);
  await f.worker().runOnce();
  expect(f.requests).toHaveLength(3);
  expect(f.logger.warn).not.toHaveBeenCalled();
});

test("[TC-SCRUM-43-I02] Provider outage survives restart with the same recipient, content and delivery ID", async t => {
  const f = await setup(t, [notice("saved-a", "attendee-a", "confirmed", "Saved confirmation")]);
  f.outage(true);
  await f.worker().runOnce();
  expect(f.pending()).toHaveLength(1);
  f.outage(false);
  await f.worker().runOnce();
  expect(f.requests[1]).toEqual(f.requests[0]);
  expect(f.pending()).toEqual([]);
});

test("[TC-SCRUM-43-I03] Expiry reminder retry revalidates storage and drops an offer reported obsolete", async t => {
  const f = await setup(t, [notice("reminder-a", "attendee-a", "offer-expiring", "Offer expires soon", "waitlist-offer-expiring")]);
  f.outage(true);
  await f.worker().runOnce();
  expect(f.requests).toHaveLength(1);
  expect(f.pending()).toHaveLength(1);
  f.current(false);
  f.outage(false);
  await f.worker().runOnce();
  expect(f.requests).toHaveLength(1);
  expect(f.pending()).toEqual([]);
  expect(f.client.rpc.mock.calls.filter(([name]) => name === "validate_waitlist_offer_reminder")).toHaveLength(2);
});

test("[TC-SCRUM-43-I04] Reminder validation outage sends nothing, keeps work pending, and recovers", async t => {
  const f = await setup(t, [notice("reminder-a", "attendee-a", "offer-expiring", "Offer expires soon", "waitlist-offer-expiring")]);
  f.failures.add("validate_waitlist_offer_reminder");
  await f.worker().runOnce();
  expect(f.requests).toEqual([]);
  expect(f.pending()).toHaveLength(1);
  f.failures.clear();
  await f.worker().runOnce();
  expect(f.requests).toHaveLength(1);
  expect(f.pending()).toEqual([]);
});

for (const name of ["enqueue_assignment_notifications", "enqueue_waitlist_offer_reminders"]) {
  test("[TC-SCRUM-43-I05-" + name + "] Failed preparation does not stop registration messages", async t => {
    const f = await setup(t, [notice("saved-a", "attendee-a", "confirmed", "Saved confirmation")]);
    f.failures.add(name);
    await f.worker().runOnce();
    expect(f.requests).toHaveLength(1);
    expect(f.pending()).toEqual([]);
  });
}

for (const field of ["message", "changeId", "requestPath", "offerChangeId", "effectiveDeadline"]) {
  test("[TC-SCRUM-43-I06] Provider contract rejects malformed " + field + " and retains unsent work", async t => {
    const reminder = ["offerChangeId", "effectiveDeadline"].includes(field);
    const saved = notice("invalid-payload", "attendee-a", reminder ? "offer-expiring" : "confirmed", "Saved message",
      reminder ? "waitlist-offer-expiring" : "registration-status");
    if (field === "requestPath") saved.payload.requestPath = "example-file.txt";
    else delete saved.payload[field];
    const f = await setup(t, [saved]);
    await f.worker().runOnce();
    expect(f.requests).toHaveLength(1);
    expect(f.pending()).toHaveLength(1);
    expect(f.logger.warn).toHaveBeenCalledOnce();
  });
}

test("[TC-SCRUM-43-I07] Storage double refuses a stale completion token and preserves the pending delivery", async t => {
  const f = await setup(t, [notice("fenced-row", "attendee-a", "confirmed", "Saved message")]);
  f.outage(true);
  await f.worker().runOnce();
  const [saved] = f.pending();
  const repository = createNotificationOutboxRepository(f.client);
  expect(await repository.complete({ ...saved, lease_token: "stale-token" })).toBe(false);
  expect(f.pending()).toHaveLength(1);
  expect(await repository.complete(saved)).toBe(true);
  expect(f.pending()).toEqual([]);
});
