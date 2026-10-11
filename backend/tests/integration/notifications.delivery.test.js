import { test, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { once } = require("node:events");
const createApp = require("../../src/app");
const { createNotificationDeliveryService } = require("../../src/modules/notifications/notificationDelivery.service");
const ID = "aaaaaaaa-0001-0000-0000-000000000000";
let event, queue, triggers, server, base, outage;
const repository = {
  findById: async id => id === ID ? { ...event } : null,
  transitionStatus: async (id, from, to, extra, coordinator) => {
    if (id !== ID || event.status !== from || event.coordinator_id !== coordinator) return null;
    event = { ...event, ...extra, status: to };
    // SCRUM-143: storage fixture models the database trigger; isolated SQL tests prove atomicity.
    if (from === "UNDER_REVIEW" && ["APPROVED", "REJECTED"].includes(to)) queue.push({
      id: "durable-fixture-id", lease_token: "lease", recipient_id: event.organiser_id,
      payload: { eventId: event.id, eventName: event.name, outcome: to.toLowerCase(), remark: event.approval_rejection_remark || "" },
    });
    return { ...event };
  },
};
const authClient = { auth: { getUser: async token => ({ data: { user: token === "expired" ? null : {
  id: token, app_metadata: { roles: token === "organiser" ? ["event_organiser"] : ["event_coordinator"] },
} }, error: null }) } };
const worker = createNotificationDeliveryService({
  repository: { claim: async () => [...queue], complete: async row => { queue = queue.filter(q => q.id !== row.id); }, retry: async () => {} },
  secretKey: "dummy-key", logger: { warn: vi.fn() },
  fetchImpl: async (_url, args) => {
    const request = JSON.parse(args.body);
    if (outage) return { ok: false };
    if (!triggers.some(t => t.transactionId === request.transactionId)) triggers.push(request);
    return { ok: true, json: async () => ({ data: { acknowledged: true, status: "processed", transactionId: request.transactionId } }) };
  },
});
beforeAll(async () => { server = createApp({ authClient, eventsRepository: repository }).listen(0, "127.0.0.1"); await once(server, "listening"); base = "http://127.0.0.1:" + server.address().port; });
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => { event = { id: ID, name: "Digital Literacy for Seniors", organiser_id: "organiser", coordinator_id: "assigned", status: "UNDER_REVIEW" }; queue = []; triggers = []; outage = false; });
const post = (action, token = "assigned", body = {}) => fetch(base + "/api/internal/events/" + ID + "/" + action, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test.each(["approve", "reject"])("[TC-SCRUM-143-26] %s over HTTP sends the stored organiser/event and refuses a repeated decision", async action => {
  const result = await post(action, "assigned", { note: "Reviewed details", organiser_id: "other", name: "Forged name", subscriberId: "other" });
  expect(result.status).toBe(200); expect(queue).toHaveLength(1);
  await worker.runOnce();
  expect(triggers).toEqual([{ name: "event-decision", to: { subscriberId: "organiser" }, transactionId: "durable-fixture-id", payload: { eventId: ID, eventName: "Digital Literacy for Seniors", outcome: action === "approve" ? "approved" : "rejected", remark: "Reviewed details" } }]);
  expect(queue).toHaveLength(0);
  expect((await post(action, "assigned", { note: "Reviewed details" })).status).toBe(409);
  await worker.runOnce(); expect(triggers).toHaveLength(1);
});
test.each([["approve", "other", {}, 403], ["approve", "organiser", {}, 403], ["approve", "expired", {}, 401], ["approve", "assigned", { note: 42 }, 400], ["reject", "assigned", {}, 400]])(
  "[TC-SCRUM-143-27] Refused action %s by %s with %j returns %i and sends nothing", async (action, token, body, status) => {
    expect((await post(action, token, body)).status).toBe(status); await worker.runOnce();
    expect(event.status).toBe("UNDER_REVIEW"); expect(queue).toHaveLength(0); expect(triggers).toHaveLength(0);
  },
);
test("[TC-SCRUM-143-28] Novu outage preserves a saved decision and replays its pending delivery on recovery", async () => {
  outage = true; expect((await post("approve")).status).toBe(200);
  await worker.runOnce(); expect(event.status).toBe("APPROVED"); expect(queue).toHaveLength(1); expect(triggers).toHaveLength(0);
  outage = false; await worker.runOnce(); expect(queue).toHaveLength(0); expect(triggers).toHaveLength(1);
});
test("[TC-SCRUM-143-27] Starting review is not an approval/rejection notification", async () => {
  event.status = "SUBMITTED"; expect((await post("start-review")).status).toBe(200);
  await worker.runOnce(); expect(queue).toHaveLength(0); expect(triggers).toHaveLength(0);
});
