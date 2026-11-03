import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createApp = require("../../src/app");

const EVENT_ID = "aaaaaaaa-0001-0000-0000-000000000000";
const OTHER_EVENT_ID = "aaaaaaaa-0002-0000-0000-000000000000";
const COORDINATOR_ID = "coordinator-user";
const OTHER_COORDINATOR_ID = "other-coordinator";
const FORGED_ACTOR_ID = "forged-actor";
const EVENT = { id: EVENT_ID, organiser_id: "organiser-user", coordinator_id: COORDINATOR_ID };
const OTHER_EVENT = {
  id: OTHER_EVENT_ID,
  organiser_id: OTHER_COORDINATOR_ID,
  coordinator_id: OTHER_COORDINATOR_ID,
};
const QUEUE_RESPONSE = {
  entries: [{
    id: "entry-1",
    attendee_id: "attendee-1",
    display_name: "Queue Member",
    position: 1,
    joined_at: "2026-09-01T00:00:00Z",
    state: "queued",
    effective_deadline: null,
    override: null,
    eligible: true,
  }],
  total: 1,
  queued: 1,
  offered: 0,
  autoOfferEnabled: true,
  serverTime: "2026-10-12T03:00:00Z",
  limit: 50,
  offset: 0,
};

let server;
let baseUrl;
let coordinatorService;
let managedEventsService;

function appFor() {
  coordinatorService = {
    getCoordinatorWaitlist: vi.fn(async () => QUEUE_RESPONSE),
    getAutoOffers: vi.fn(async () => ({ enabled: true })),
    setAutoOffers: vi.fn(async (_event, enabled) => ({
      enabled,
      updatedAt: "2026-10-12T03:00:00Z",
    })),
    promoteEntry: vi.fn(async (_event, entryId) => ({
      outcome: "registered_over_capacity",
      entryId,
      registrationId: "registration-1",
      enrolledAttendees: 11,
    })),
  };
  managedEventsService = {
    async findManagedEvent(eventId, userId) {
      if (eventId === EVENT_ID && userId === COORDINATOR_ID) return EVENT;
      if (eventId === OTHER_EVENT_ID && userId === OTHER_COORDINATOR_ID) return OTHER_EVENT;
      return null;
    },
  };

  return createApp({
    authClient: {
      auth: {
        async getUser(token) {
          const identities = {
            "coordinator-token": { id: COORDINATOR_ID, roles: ["event_coordinator"] },
            "organiser-token": { id: "organiser-user", roles: ["event_organiser"] },
            "attendee-token": { id: "attendee-user", roles: ["attendee"] },
            "other-coordinator-token": { id: OTHER_COORDINATOR_ID, roles: ["event_coordinator"] },
          };
          const identity = identities[token];
          return {
            data: {
              user: identity
                ? { id: identity.id, app_metadata: { roles: identity.roles }, user_metadata: {} }
                : null,
            },
            error: null,
          };
        },
      },
    },
    managedEventsService,
    waitlistCoordinatorService: coordinatorService,
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "test-public-key",
  });
}

async function startServer() {
  server = appFor().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function request(path, { token = "coordinator-token", method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const responseText = await response.text();
  let responseBody = responseText;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    // Express's current unmatched-route response is HTML until the route exists.
  }
  return { status: response.status, body: responseBody };
}

beforeEach(startServer);
afterEach(async () => {
  if (!server) return;
  server.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.once("close", resolve));
  server = null;
});

describe("coordinator waitlist routes", () => {
  test("a coordinator reads the ON-by-default setting", async () => {
    const { status, body } = await request(
      `/api/managed-events/${EVENT_ID}/waitlist/settings`,
    );

    expect(status).toBe(200);
    expect(body).toEqual({ setting: { enabled: true } });
    expect(coordinatorService.getAutoOffers).toHaveBeenCalledWith(EVENT);
  });

  test("a coordinator sees the ordered, paginated waitlist without attendee contact or registration data", async () => {
    const { status, body } = await request(
      `/api/managed-events/${EVENT_ID}/waitlist?limit=50&offset=0`,
    );

    expect(status).toBe(200);
    expect(body).toEqual({ waitlist: QUEUE_RESPONSE });
    expect(JSON.stringify(body)).not.toMatch(/email|phone|registration_data/i);
    expect(coordinatorService.getCoordinatorWaitlist).toHaveBeenCalledWith(
      EVENT,
      { limit: 50, offset: 0 },
    );
  });

  test.each([
    ["an unauthenticated caller", null, 401],
    ["an attendee", "attendee-token", 403],
    ["a coordinator assigned to another event", "other-coordinator-token", 403],
  ])("%s cannot read the event waitlist", async (_description, token, expectedStatus) => {
    const { status } = await request(`/api/managed-events/${EVENT_ID}/waitlist`, { token });

    expect(status).toBe(expectedStatus);
    expect(coordinatorService.getCoordinatorWaitlist).not.toHaveBeenCalled();
  });

  test("an event organiser cannot use coordinator waitlist controls", async () => {
    const { status } = await request(`/api/managed-events/${EVENT_ID}/waitlist`, {
      token: "organiser-token",
    });

    expect(status).toBe(403);
    expect(coordinatorService.getCoordinatorWaitlist).not.toHaveBeenCalled();
  });

  test("the setting update uses the verified coordinator identity, not a body actor", async () => {
    const { status, body } = await request(
      `/api/managed-events/${EVENT_ID}/waitlist/settings`,
      {
        method: "PATCH",
        body: { enabled: false, actorId: FORGED_ACTOR_ID },
      },
    );

    expect(status).toBe(200);
    expect(body).toEqual({ setting: { enabled: false, updatedAt: "2026-10-12T03:00:00Z" } });
    expect(coordinatorService.setAutoOffers).toHaveBeenCalledWith(EVENT, false, COORDINATOR_ID);
    expect(coordinatorService.setAutoOffers).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      FORGED_ACTOR_ID,
    );
  });

  test("the setting update rejects non-boolean values without calling storage", async () => {
    const { status } = await request(
      `/api/managed-events/${EVENT_ID}/waitlist/settings`,
      { method: "PATCH", body: { enabled: "false" } },
    );

    expect(status).toBe(400);
    expect(coordinatorService.setAutoOffers).not.toHaveBeenCalled();
  });

  test("manual promotion uses the verified actor and returns the direct-registration outcome", async () => {
    const { status, body } = await request(
      `/api/managed-events/${EVENT_ID}/waitlist/entry-1/promote`,
      {
        method: "POST",
        body: { reason: "Accessibility accommodation", actorId: FORGED_ACTOR_ID },
      },
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      result: {
        outcome: "registered_over_capacity",
        entryId: "entry-1",
        registrationId: "registration-1",
        enrolledAttendees: 11,
      },
    });
    expect(coordinatorService.promoteEntry).toHaveBeenCalledWith(
      EVENT,
      "entry-1",
      COORDINATOR_ID,
      "Accessibility accommodation",
    );
  });

  test("an actor cannot toggle or promote another coordinator's event", async () => {
    const settings = await request(`/api/managed-events/${OTHER_EVENT_ID}/waitlist/settings`, {
      method: "PATCH",
      body: { enabled: false },
    });
    const promotion = await request(
      `/api/managed-events/${OTHER_EVENT_ID}/waitlist/entry-1/promote`,
      { method: "POST", body: {} },
    );

    expect(settings.status).toBe(403);
    expect(promotion.status).toBe(403);
    expect(coordinatorService.setAutoOffers).not.toHaveBeenCalled();
    expect(coordinatorService.promoteEntry).not.toHaveBeenCalled();
  });

  test("unexpected coordinator service failures remain server errors", async () => {
    coordinatorService.getCoordinatorWaitlist.mockRejectedValueOnce(new Error("storage unavailable"));

    const { status } = await request(`/api/managed-events/${EVENT_ID}/waitlist`);

    expect(status).toBe(500);
  });
});
