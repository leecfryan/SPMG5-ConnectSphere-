import { test, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const { createNotificationDeliveryService } = require("../../src/modules/notifications/notificationDelivery.service");
const { createNotificationOutboxRepository } = require("../../src/modules/notifications/notificationOutbox.repository");

// SCRUM-155: start at persisted notification work, without invoking an event operation.
function notice(id, recipient, assignmentType) {
  return {
    id, recipient_id: recipient, lease_token: "lease-" + id, workflow: "event-assignment",
    payload: { assignmentChangeId: "saved-change", eventId: "saved-event", eventName: "Community Open Day",
      assignedById: "verified-lead", assignedByName: "Ada Lead", assignmentType },
  };
}

async function setup(t, rows) {
  let pending = structuredClone(rows);
  let prepared = false;
  const attempts = [];
  const rejectedIds = new Set();
  const logger = { warn: vi.fn() };
  const provider = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    attempts.push({ path: request.url, method: request.method, body, dedupId: request.headers["idempotency-key"] });
    response.setHeader("Content-Type", "application/json");
    if (rejectedIds.has(body.transactionId)) {
      response.writeHead(503); response.end(JSON.stringify({ error: "fixture provider unavailable" }));
    } else {
      response.end(JSON.stringify({ data: { acknowledged: true, status: "processed", transactionId: body.transactionId } }));
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.onTestFinished(() => new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); }));
  // This fixture stores already-prepared payloads; real SQL recipient selection is tested in tests/sql.
  const client = { rpc: vi.fn((name, args) => ({
    abortSignal: async () => {
      if (["enqueue_registration_notifications", "enqueue_waitlist_offer_reminders"].includes(name)) return { data: 0, error: null };
      if (name === "enqueue_assignment_notifications") { prepared = true; return { data: 0, error: null }; }
      if (name === "claim_notification_outbox") return { data: prepared ? structuredClone(pending) : [], error: null };
      if (name === "finish_notification_outbox") {
        if (args.succeeded) pending = pending.filter(row => !(row.id === args.delivery_id && row.lease_token === args.claim_token));
        return { data: true, error: null };
      }
      throw new Error("Unexpected notification RPC");
    },
  })) };
  const repository = createNotificationOutboxRepository(client);
  const worker = () => createNotificationDeliveryService({ repository, secretKey: "local-fixture-key", logger,
    fetchImpl: (url, args) => {
      expect(url).toBe("https://api.novu.co/v1/events/trigger");
      return fetch(`http://127.0.0.1:${provider.address().port}/trigger`, args);
    },
  });
  return { worker, attempts, rejectedIds, client, logger, pending: () => pending };
}

test("[TC-SCRUM-155-N01] Initial assignment notification reaches only the assigned coordinator with event and assigner names", async t => {
  const f = await setup(t, [notice("initial-delivery", "coordinator-a", "assigned")]);
  await f.worker().runOnce();
  expect(f.attempts).toEqual([{
    path: "/trigger", method: "POST", dedupId: "initial-delivery",
    body: { name: "event-assignment", to: { subscriberId: "coordinator-a" }, transactionId: "initial-delivery",
      payload: { assignmentChangeId: "saved-change", eventId: "saved-event", eventName: "Community Open Day",
        assignedById: "verified-lead", assignedByName: "Ada Lead", assignmentType: "assigned" } },
  }]);
  expect(f.pending()).toEqual([]);
  expect(f.logger.warn).not.toHaveBeenCalled();
});

test("[TC-SCRUM-155-N02] Reassignment delivers exactly one notice to each incoming and outgoing coordinator with correct attribution", async t => {
  const f = await setup(t, [notice("incoming-delivery", "coordinator-b", "reassigned"), notice("outgoing-delivery", "coordinator-a", "reassigned-away")]);
  await f.worker().runOnce();
  expect(f.attempts.map(attempt => attempt.body)).toEqual([
    { name: "event-assignment", to: { subscriberId: "coordinator-b" }, transactionId: "incoming-delivery",
      payload: { assignmentChangeId: "saved-change", eventId: "saved-event", eventName: "Community Open Day",
        assignedById: "verified-lead", assignedByName: "Ada Lead", assignmentType: "reassigned" } },
    { name: "event-assignment", to: { subscriberId: "coordinator-a" }, transactionId: "outgoing-delivery",
      payload: { assignmentChangeId: "saved-change", eventId: "saved-event", eventName: "Community Open Day",
        assignedById: "verified-lead", assignedByName: "Ada Lead", assignmentType: "reassigned-away" } },
  ]);
  expect(f.pending()).toEqual([]);
  await f.worker().runOnce();
  expect(f.attempts).toHaveLength(2);
});

test("[TC-SCRUM-155-N03] A failed recipient remains pending across worker restart without replaying the successful recipient", async t => {
  const f = await setup(t, [notice("incoming-delivery", "coordinator-b", "reassigned"), notice("outgoing-delivery", "coordinator-a", "reassigned-away")]);
  f.rejectedIds.add("incoming-delivery");
  await f.worker().runOnce();
  expect(f.pending().map(row => row.recipient_id)).toEqual(["coordinator-b"]);
  expect(f.client.rpc).toHaveBeenCalledWith("finish_notification_outbox", {
    delivery_id: "incoming-delivery", claim_token: "lease-incoming-delivery", succeeded: false,
  });
  f.rejectedIds.clear();
  await f.worker().runOnce();
  expect(f.attempts).toHaveLength(3);
  expect(f.attempts[2]).toEqual(f.attempts[0]);
  expect(f.attempts.filter(a => a.body.to.subscriberId === "coordinator-a")).toHaveLength(1);
  expect(f.pending()).toEqual([]);
});
