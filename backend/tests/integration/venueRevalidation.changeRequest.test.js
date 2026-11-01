// SCRUM-38 R1: accepting a change request (SCRUM-165) re-validates the event's
// venue bookings when the change can affect them. Real createApp, routes,
// guards and SCRUM-165's service over the fake storage; only the venue
// service is a stub, so these tests see exactly when re-validation is asked for.
import { test, expect, vi } from "vitest";
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const createApp = require("../../src/app");
const storage = require("../../../tests/playwright/support/registration-storage.cjs");

const FLAGGED = { checked: 2, flagged: [{ booking_id: "b1", venue_name: "Hall A", reason: "After the event changed: Over capacity: …" }] };

async function setup(t, { proposed, revalidate = vi.fn(async () => FLAGGED) } = {}) {
  const organiser = { id: randomUUID(), email: "organiser@test", email_confirmed_at: "2026-01-01", app_metadata: { roles: ["event_organiser"] }, user_metadata: {} };
  const coordinator = { id: randomUUID(), email: "coord@test", email_confirmed_at: "2026-01-01", app_metadata: { roles: ["event_coordinator"] }, user_metadata: {} };
  const users = [organiser, coordinator];
  const record = {
    id: randomUUID(), name: "Annual Gala", purpose: "Celebration", description: "Year-end event",
    start_time: "2099-06-01T10:00:00.000Z", end_time: "2099-06-01T18:00:00.000Z",
    registration_start: null, registration_end: null, expected_attendance: 100,
    venue_requirements: "Ballroom", accessibility_needs: null, equipment_needs: "Projector", other_comments: null,
    status: "APPROVED", organiser_id: organiser.id, coordinator_id: coordinator.id,
    submitted_at: "2026-01-01T00:00:00Z", updated_at: "2026-10-29T00:00:00.000Z",
    pending_change_request: { proposed_changes: proposed, reason: "Plans changed", requested_at: "2026-10-29T10:00:00.000Z", requested_by: organiser.id },
  };

  const client = storage(new Map([[organiser.id, { events: [record] }]]));
  require("../../../tests/playwright/support/assignment-notification-storage.cjs")(client, new Map());
  client.auth = { admin: {
    async listUsers() { return { data: { users }, error: null }; },
    async getUserById(id) { return { data: { user: users.find(u => u.id === id) }, error: null }; },
  } };
  const venuesService = { revalidateBookingsForEvent: revalidate, releaseBookingsForCancelledEvent: vi.fn() };

  const app = createApp({ dataClient: client, venuesService, authClient: { auth: {
    async getUser(token) { return { data: { user: users.find(u => u.id === token) || null }, error: null }; },
  } }, eventsRepository: { findById: async (id) => id === record.id ? { ...record } : null } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));

  const decide = (decision) => fetch(`http://127.0.0.1:${server.address().port}/api/internal/events/${record.id}/decide-change-request`, {
    method: "POST",
    headers: { Authorization: "Bearer " + coordinator.id, "Content-Type": "application/json" },
    body: JSON.stringify({ decision, reason: "Reviewed" }),
  });
  return { decide, record, revalidate, venuesService };
}

test("[SCRUM-38] TC-SCRUM-38-12: accepting a higher attendance re-validates the event's venues once", async t => {
  const { decide, record, revalidate } = await setup(t, { proposed: { expected_attendance: 300 } });

  const response = await decide("approve");

  expect(response.status).toBe(200);
  expect(revalidate).toHaveBeenCalledExactlyOnceWith(record.id);
  expect(record.expected_attendance).toBe(300);
  // The coordinator is told straight away which venues no longer fit.
  expect((await response.json()).venue_recheck).toEqual(FLAGGED);
});

test("[SCRUM-38] TC-SCRUM-38-13: an equipment-requirements change re-validates too, although SCRUM-165 keeps the event APPROVED", async t => {
  const { decide, record, revalidate } = await setup(t, { proposed: { equipment_needs: "Two projectors and a stage" } });

  expect((await decide("approve")).status).toBe(200);
  expect(record.status).toBe("APPROVED");
  expect(revalidate).toHaveBeenCalledExactlyOnceWith(record.id);
});

test("[SCRUM-38] TC-SCRUM-38-14: a change that cannot affect venues (name only) does not re-validate", async t => {
  const { decide, revalidate } = await setup(t, { proposed: { name: "Annual Gala 2099" } });

  const response = await decide("approve");
  expect(response.status).toBe(200);
  expect(revalidate).not.toHaveBeenCalled();
  expect((await response.json()).venue_recheck).toBeNull();
});

test("[SCRUM-38] TC-SCRUM-38-15: rejecting a change request leaves the event and its venues alone", async t => {
  const { decide, record, revalidate } = await setup(t, { proposed: { expected_attendance: 300 } });

  expect((await decide("reject")).status).toBe(200);
  expect(record.expected_attendance).toBe(100);
  expect(revalidate).not.toHaveBeenCalled();
});

test("[SCRUM-38] TC-SCRUM-38-16: the same start time written in another format is not a change and does not re-validate", async t => {
  const { decide, revalidate } = await setup(t, { proposed: { start_time: "2099-06-01T18:00:00+08:00" } });

  expect((await decide("approve")).status).toBe(200);
  expect(revalidate).not.toHaveBeenCalled();
});

test("[SCRUM-38] TC-SCRUM-38-17: a re-validation failure is logged and the accepted change still stands", async t => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { decide, record } = await setup(t, {
    proposed: { expected_attendance: 300 },
    revalidate: vi.fn(async () => { throw new Error("venue storage down"); }),
  });

  const response = await decide("approve");

  expect(response.status).toBe(200);
  expect(record.expected_attendance).toBe(300);
  expect((await response.json()).venue_recheck).toEqual({ failed: true });
  expect(error).toHaveBeenCalledWith(expect.stringContaining("venue re-validation failed"), "venue storage down");
  error.mockRestore();
});
