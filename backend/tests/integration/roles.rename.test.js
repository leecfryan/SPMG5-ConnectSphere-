import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { getPermissions } = require("../../src/auth/permissions");
const EVENT_ID = "aaaaaaaa-0001-0000-0000-000000000000";
const LEAD_PERMISSIONS = [
  "event_organisers.read", "events.assign", "events.assign_coordinator",
  "events.cancel", "events.postpone", "events.review", "internal.access",
];
let roles, stored, server, base;
const repository = { findById: vi.fn(), cancel: vi.fn(), postpone: vi.fn(), transitionStatus: vi.fn() };
const releaseVenueBookingsForCancelledEvent = vi.fn();
const equipmentService = { releaseReservationsForCancelledEvent: vi.fn() };
const queue = { findSubmittedUnassigned: vi.fn() };
const authClient = { auth: { getUser: vi.fn(async () => ({
  data: { user: {
    id: "lead", app_metadata: { roles },
    user_metadata: { roles: ["event_coordinator_lead", "event_ops_manager", "safety_officer"] },
  } }, error: null,
})) } };

beforeAll(async () => {
  server = createApp({ authClient, eventsRepository: repository,
    assignmentDependencies: { repository: queue, directory: {} },
    venuesService: { releaseBookingsForCancelledEvent: releaseVenueBookingsForCancelledEvent },
    equipmentDependencies: { equipmentService },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  roles = ["event_coordinator_lead"];
  stored = { id: EVENT_ID, status: "SUBMITTED", coordinator_id: "someone-else" };
  repository.findById.mockReset().mockImplementation(async () => ({ ...stored }));
  repository.cancel.mockReset().mockImplementation(async (_id, extra) => {
    stored = { ...stored, ...extra, status: "CANCELLED" };
    return { ...stored };
  });
  repository.postpone.mockReset().mockImplementation(async (_id, extra) => {
    stored = { ...stored, ...extra, status: "POSTPONED" };
    return { ...stored };
  });
  releaseVenueBookingsForCancelledEvent.mockReset().mockResolvedValue([]);
  equipmentService.releaseReservationsForCancelledEvent.mockReset().mockResolvedValue({});
  repository.transitionStatus.mockReset();
  queue.findSubmittedUnassigned.mockReset().mockResolvedValue([{ ...stored }]);
});
function send(path, method = "GET", data) {
  return fetch(base + path, { method, headers: {
    Authorization: "Bearer same-token", "Content-Type": "application/json",
    "X-User-Role": "event_coordinator_lead",
  }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}

test.each([
  ["001", "event_coordinator_lead"], ["002", "event_ops_manager"],
])("[SCRUM-142-INT-%s] trusted %s returns the canonical lead role and exact existing capabilities", async (_id, role) => {
  roles = [role];
  const identity = await send("/api/auth/me");
  expect(identity.status).toBe(200);
  const body = await identity.json();
  expect(body.user.roles).toEqual(["event_coordinator_lead"]);
  expect(body.user.accountTypes).toEqual(["internal"]);
  expect(body.permissions.sort()).toEqual(LEAD_PERMISSIONS);
  expect((await send("/api/internal/access")).status).toBe(200);
  const assignment = await send("/api/internal/events/unassigned");
  expect(assignment.status).toBe(200);
  expect(await assignment.json()).toEqual({ events: [stored] });
  for (const path of ["/api/venues", "/api/equipment", `/api/managed-events/${EVENT_ID}/waitlist`, "/api/technical-support/equipment-requests"]) {
    expect((await send(path)).status, path).toBe(403);
  }
});

test("[SCRUM-142-INT-003] legacy, canonical and duplicate roles combine without duplicate capabilities", async () => {
  roles = ["attendee", "event_ops_manager", "event_coordinator_lead", "venue_staff", "attendee"];
  const identity = await (await send("/api/auth/me")).json();
  expect(identity.user.roles).toEqual(["attendee", "event_coordinator_lead", "venue_staff"]);
  expect(identity.user.accountTypes).toEqual(["internal", "external"]);
  expect(identity.permissions.sort()).toEqual([
    ...LEAD_PERMISSIONS, "bookings.decide", "bookings.read", "events.browse",
    "registrations.manage", "venues.holds", "venues.read", "venues.unavailability", "venues.update",
  ].sort());
});

test.each([
  ["004", "event_coordinator_lead"], ["005", "event_ops_manager"],
])("[SCRUM-142-INT-%s] %s can cancel an event assigned to someone else", async (_id, role) => {
  roles = [role];
  const response = await send(`/api/internal/events/${EVENT_ID}/cancel`, "POST", { reason: "Duplicate booking" });
  expect(response.status).toBe(200);
  expect((await response.json()).event).toMatchObject({ status: "CANCELLED", cancelled_by: "lead" });
  expect(repository.cancel).toHaveBeenCalledWith(EVENT_ID,
    expect.objectContaining({ cancellation_reason: "Duplicate booking", cancelled_by: "lead" }), undefined);
});

test.each([
  ["006", "event_coordinator_lead"], ["007", "event_ops_manager"],
])("[SCRUM-142-INT-%s] %s does not gain the assigned coordinator's review decisions", async (_id, role) => {
  roles = [role];
  for (const action of ["start-review", "approve", "reject"]) {
    expect((await send(`/api/internal/events/${EVENT_ID}/${action}`, "POST", { note: "Forged approval" })).status).toBe(403);
  }
  expect(repository.transitionStatus).not.toHaveBeenCalled();
  expect(stored).toEqual({ id: EVENT_ID, status: "SUBMITTED", coordinator_id: "someone-else" });
});

test("[SCRUM-142-INT-008] editable metadata, headers, query and body cannot grant either lead role", async () => {
  roles = ["attendee"];
  const identity = await (await send("/api/auth/me?role=event_coordinator_lead")).json();
  expect(identity.user.roles).toEqual(["attendee"]);
  expect(identity.permissions).toEqual(["events.browse", "registrations.manage"]);
  const before = { ...stored };
  const response = await send(`/api/internal/events/${EVENT_ID}/cancel`, "POST", {
    reason: "Forged cancellation", roles: ["event_coordinator_lead", "event_ops_manager"], isCoordinatorLead: true,
  });
  expect(response.status).toBe(403);
  expect(repository.cancel).not.toHaveBeenCalled();
  expect(stored).toEqual(before);
});

test.each([
  ["009", "event_coordinator_lead"], ["010", "event_ops_manager"],
])("[SCRUM-142-INT-%s] removing %s revokes its capabilities on the next request and keeps other roles", async (_id, role) => {
  roles = [role, "attendee"];
  expect((await send("/api/internal/events/unassigned")).status).toBe(200);
  roles = ["attendee"];
  expect((await send("/api/internal/events/unassigned")).status).toBe(403);
  const identity = await (await send("/api/auth/me")).json();
  expect(identity.user.roles).toEqual(["attendee"]);
  expect(identity.permissions).toEqual(["events.browse", "registrations.manage"]);
});

test("[SCRUM-142-POLICY-001] the legacy identifier grants nothing directly outside verified authentication", () => {
  expect(getPermissions(["event_ops_manager"])).toEqual([]);
  expect(getPermissions(["event_coordinator_lead"]).sort()).toEqual(LEAD_PERMISSIONS);
});

test.each([
  ["011", "event_coordinator_lead"], ["012", "event_ops_manager"],
])("[SCRUM-142-INT-%s] %s retains postponement access with venue release and no equipment release", async (_id, role) => {
  roles = [role];
  const response = await send(`/api/internal/events/${EVENT_ID}/postpone`, "POST", { reason: "New date not yet known" });
  expect(response.status).toBe(200);
  expect((await response.json()).event).toMatchObject({ status: "POSTPONED", postponed_by: "lead", postponement_reason: "New date not yet known" });
  expect(repository.postpone).toHaveBeenCalledWith(EVENT_ID,
    expect.objectContaining({ postponed_by: "lead", postponement_reason: "New date not yet known" }), undefined);
  expect(releaseVenueBookingsForCancelledEvent).toHaveBeenCalledWith(EVENT_ID);
  expect(equipmentService.releaseReservationsForCancelledEvent).not.toHaveBeenCalled();
});

test("[SCRUM-142-INT-013] forged lead claims cannot postpone or release arrangements", async () => {
  roles = ["attendee"];
  const before = { ...stored };
  const response = await send(`/api/internal/events/${EVENT_ID}/postpone`, "POST", {
    reason: "Forged postponement", roles: ["event_coordinator_lead", "event_ops_manager"], isCoordinatorLead: true,
  });
  expect(response.status).toBe(403);
  expect(repository.postpone).not.toHaveBeenCalled();
  expect(releaseVenueBookingsForCancelledEvent).not.toHaveBeenCalled();
  expect(equipmentService.releaseReservationsForCancelledEvent).not.toHaveBeenCalled();
  expect(stored).toEqual(before);
});


// SCRUM-140 adds the deferred safety review read; nothing else is granted.
test("[SCRUM-142-SAFETY-INT-001] trusted Safety Officer is internal with basic staff access and safety review reading only", async () => {
  roles = ["safety_officer", "unknown", "safety_officer"];
  const identity = await (await send("/api/auth/me")).json();
  expect(identity.user.roles).toEqual(["safety_officer"]);
  expect(identity.user.accountTypes).toEqual(["internal"]);
  expect(identity.permissions).toEqual(["events.safety.read", "internal.access"]);
  const access = await send("/api/internal/access");
  expect(access.status).toBe(200);
  expect(await access.json()).toEqual({ responsibilities: [
    { permission: "events.safety.read", label: "Operational safety review", requiresRecordCheck: false },
  ] });
});

test("[SCRUM-142-SAFETY-INT-002] Safety Officer plus attendee preserves both types and removes only staff access on revocation", async () => {
  roles = ["safety_officer", "attendee", "safety_officer"];
  const identity = await (await send("/api/auth/me")).json();
  expect(identity.user.roles).toEqual(["safety_officer", "attendee"]);
  expect(identity.user.accountTypes).toEqual(["internal", "external"]);
  expect(identity.permissions.sort()).toEqual(["events.browse", "events.safety.read", "internal.access", "registrations.manage"]);
  expect((await send("/api/internal/access")).status).toBe(200);
  roles = ["attendee"];
  expect((await send("/api/internal/access")).status).toBe(403);
  const after = await (await send("/api/auth/me")).json();
  expect(after.user.roles).toEqual(["attendee"]);
  expect(after.permissions).toEqual(["events.browse", "registrations.manage"]);
});

test("[SCRUM-142-SAFETY-INT-003] Safety Officer combines with Venue Staff without lead or coordinator capabilities", async () => {
  roles = ["safety_officer", "venue_staff"];
  const identity = await (await send("/api/auth/me")).json();
  expect(identity.user.roles).toEqual(roles);
  expect(identity.permissions.sort()).toEqual([
    "bookings.decide", "bookings.read", "events.safety.read", "internal.access", "venues.holds", "venues.read", "venues.unavailability", "venues.update",
  ]);
});

test("[SCRUM-142-SAFETY-INT-004] Safety Officer can accompany the renamed lead without widening its capabilities", async () => {
  roles = ["event_ops_manager", "safety_officer"];
  const identity = await (await send("/api/auth/me")).json();
  expect(identity.user.roles).toEqual(["event_coordinator_lead", "safety_officer"]);
  expect(identity.permissions.sort()).toEqual([...LEAD_PERMISSIONS, "events.safety.read"].sort());
  expect((await send("/api/internal/events/unassigned")).status).toBe(200);
});

test("[SCRUM-142-SAFETY-INT-005] officer-only business reads and writes are refused before touching event data", async () => {
  roles = ["safety_officer"];
  const before = { ...stored };
  for (const route of ["/api/venues", "/api/equipment", "/api/internal/events/unassigned", "/api/event-workspace/manager", "/api/events", "/api/managed-events",
    "/api/internal/events/" + EVENT_ID + "/safety-readiness"]) {
    expect((await send(route)).status, route).toBe(403);
  }
  for (const action of ["cancel", "postpone", "start-review", "approve", "reject", "submit-safety-check", "withdraw-safety-check"]) {
    expect((await send("/api/internal/events/" + EVENT_ID + "/" + action, "POST", { reason: "Not authorised" })).status, action).toBe(403);
  }
  expect(repository.findById).not.toHaveBeenCalled();
  expect(repository.cancel).not.toHaveBeenCalled();
  expect(repository.postpone).not.toHaveBeenCalled();
  expect(repository.transitionStatus).not.toHaveBeenCalled();
  expect(queue.findSubmittedUnassigned).not.toHaveBeenCalled();
  expect(releaseVenueBookingsForCancelledEvent).not.toHaveBeenCalled();
  expect(equipmentService.releaseReservationsForCancelledEvent).not.toHaveBeenCalled();
  expect(stored).toEqual(before);
});

test("[SCRUM-142-SAFETY-INT-006] editable metadata and caller claims cannot grant Safety Officer staff access", async () => {
  roles = ["attendee"];
  const response = await fetch(base + "/api/auth/me?role=safety_officer", { headers: {
    Authorization: "Bearer same-token", "X-User-Role": "safety_officer",
  } });
  expect(response.status).toBe(200);
  const identity = await response.json();
  expect(identity.user.roles).toEqual(["attendee"]);
  expect(identity.permissions).toEqual(["events.browse", "registrations.manage"]);
  expect((await send("/api/internal/access?role=safety_officer", "POST", { roles: ["safety_officer"] })).status).toBe(403);
});
