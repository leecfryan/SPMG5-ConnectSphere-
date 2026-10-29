import { expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const { createNotificationDeliveryService } = require("../../src/modules/notifications/notificationDelivery.service");
const { createNotificationOutboxRepository } = require("../../src/modules/notifications/notificationOutbox.repository");

function notice(id, recipient, changeType = "expiring") {
  return { id, recipient_id: recipient, lease_token: "lease-" + id, workflow: "venue-hold-expiry", payload: {
    venueId: "venue-a", venueName: "Marina Hall", eventId: "event-a", eventName: "Community Open Day",
    bookingDate: "2030-01-01", expiresAt: "2030-01-01T01:00:00Z", changeType,
    message: changeType === "expiring" ? "Your tentative hold at Marina Hall for Community Open Day expires at 2030-01-01 01:00:00 UTC." : "Your tentative hold at Marina Hall for Community Open Day expired at 2030-01-01 01:00:00 UTC. The expired reservation has been released.",
    requestPath: "/venues/venue-a/availability", stateIds: ["state-" + id],
  } };
}

// SCRUM-163: starts with saved outbox data; database lifecycle/clock logic is tested in actual PostgreSQL.
async function setup(t, rows) {
  let pending = [], prepared = false, outage = false, validity = true, validityOutage = false;
  const requests = [], responses = [];
  const provider = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const trigger = JSON.parse(body), payload = trigger.payload;
    requests.push({ trigger, key: request.headers["idempotency-key"] });
    const fields = ["venueId", "venueName", "eventId", "eventName", "bookingDate", "expiresAt", "changeType", "message", "requestPath"];
    const valid = trigger.name === "venue-hold-expiry" && fields.every(field => typeof payload?.[field] === "string" && payload[field].length)
      && ["expiring", "expired"].includes(payload.changeType) && Number.isFinite(Date.parse(payload.expiresAt)) && payload.requestPath.startsWith("/venues/");
    const status = outage ? 503 : valid ? 200 : 422;
    responses.push(status);
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ acknowledged: valid && !outage, status: "processed", transactionId: trigger.transactionId }));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.onTestFinished(() => new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); }));
  const client = { rpc: vi.fn((name, args) => ({ abortSignal: async () => {
    if (name === "enqueue_venue_hold_notifications") {
      if (prepared) return { data: 0, error: null };
      prepared = true; pending = structuredClone(rows); return { data: rows.length, error: null };
    }
    if (name === "enqueue_assignment_notifications") return { data: 0, error: null };
    if (name === "claim_notification_outbox") return { data: structuredClone(pending), error: null };
    if (name === "validate_venue_hold_notification") return validityOutage ? { data: null, error: { message: "private storage" } } : { data: validity, error: null };
    if (name === "finish_notification_outbox") {
      const match = pending.find(row => row.id === args.delivery_id && row.lease_token === args.claim_token);
      if (match && args.succeeded) pending = pending.filter(row => row !== match);
      return { data: Boolean(match), error: null };
    }
    throw new Error("Unexpected RPC " + name);
  } })) };
  const repository = createNotificationOutboxRepository(client);
  const worker = () => createNotificationDeliveryService({ repository, secretKey: "local-fixture-only", logger: { warn: vi.fn() },
    fetchImpl: (_url, options) => fetch("http://127.0.0.1:" + provider.address().port, options) });
  return { worker, requests, responses, pending: () => pending, outage: value => { outage = value; }, validity: value => { validity = value; }, validityOutage: value => { validityOutage = value; } };
}

test("[TC-SCRUM-163-I01] Warning and expiry payloads reach their saved coordinators with stable delivery identity", async t => {
  const rows = [notice("warning", "coordinator-a"), notice("expiry", "coordinator-b", "expired")];
  const f = await setup(t, rows);
  await f.worker().runOnce();
  expect(f.requests).toEqual(rows.map(row => ({ key: row.id, trigger: { name: "venue-hold-expiry", to: { subscriberId: row.recipient_id }, transactionId: row.id, payload: row.payload } })));
  expect(f.pending()).toEqual([]);
  await f.worker().runOnce();
  expect(f.requests).toHaveLength(2);
});
test("[TC-SCRUM-163-I02] Provider outage survives worker restart without changing content, owner or deduplication ID", async t => {
  const f = await setup(t, [notice("warning", "coordinator-a")]);
  f.outage(true); await f.worker().runOnce();
  expect(f.pending()).toHaveLength(1);
  f.outage(false); await f.worker().runOnce();
  expect(f.requests[1]).toEqual(f.requests[0]);
  expect(f.pending()).toEqual([]);
});
test("[TC-SCRUM-163-I03] Storage validation outage sends nothing, and a subsequently obsolete warning is removed", async t => {
  const f = await setup(t, [notice("warning", "coordinator-a")]);
  f.validityOutage(true); await f.worker().runOnce();
  expect(f.requests).toEqual([]); expect(f.pending()).toHaveLength(1);
  f.validityOutage(false); f.validity(false); await f.worker().runOnce();
  expect(f.requests).toEqual([]); expect(f.pending()).toEqual([]);
});
for (const field of ["venueName", "eventName", "expiresAt", "message"]) {
  test("[TC-SCRUM-163-I04-" + field + "] Provider contract rejects missing " + field + " without acknowledging delivery", async t => {
    const row = notice("bad-payload", "coordinator-a");
    delete row.payload[field];
    const f = await setup(t, [row]);
    await f.worker().runOnce();
    expect(f.requests).toHaveLength(1);
    expect(f.responses).toEqual([422]);
    expect(f.requests[0].trigger.payload).not.toHaveProperty(field);
    expect(f.pending()).toEqual([row]);
  });
}
