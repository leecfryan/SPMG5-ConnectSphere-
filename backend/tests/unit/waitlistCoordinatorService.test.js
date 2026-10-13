import { describe, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createWaitlistCoordinatorService = require("../../src/modules/registrations/waitlistCoordinatorService");

const EVENT = { id: "event-1" };

function makeClient({ queueResult, rpcResult } = {}) {
  const calls = [];
  const client = {
    rpc: vi.fn(async (name, args) => {
      calls.push({ name, args });
      if (name === "get_coordinator_event_waitlist") return queueResult;
      if (name === "promote_waitlist_entry") {
        return rpcResult ?? {
          data: { outcome: "registered_over_capacity", entry_id: "entry-1" },
          error: null,
        };
      }
      return rpcResult ?? { data: { outcome: "updated" }, error: null };
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async (attendeeId) => ({
          data: {
            user: {
              id: attendeeId,
              email: "private@example.test",
              user_metadata: { full_name: " Queue Member " },
            },
          },
          error: null,
        })),
      },
    },
  };
  return { client, calls };
}

describe("waitlist coordinator service", () => {
  test("returns only coordinator-safe queue fields and resolves display names from Auth metadata", async () => {
    const { client, calls } = makeClient({
      queueResult: {
        data: {
          outcome: "found",
          entries: [{
            id: "entry-1",
            attendee_id: "attendee-1",
            position: 1,
            joined_at: "2026-09-01T00:00:00Z",
            state: "queued",
            effective_deadline: null,
            override: { by: "coordinator-1", at: "2026-09-02T00:00:00Z", reason: "priority" },
            eligible: true,
            email: "should-not-leak@example.test",
            phone: "+10000000000",
            registration_data: { dietary: "private" },
          }],
          total: 1,
          queued: 1,
          offered: 0,
          auto_offer_enabled: true,
          server_time: "2026-10-12T03:00:00Z",
        },
        error: null,
      },
    });
    const service = createWaitlistCoordinatorService(client);

    const result = await service.getCoordinatorWaitlist(EVENT, { limit: 25, offset: 0 });

    expect(calls[0]).toEqual({
      name: "get_coordinator_event_waitlist",
      args: { p_event_id: EVENT.id, p_limit: 25, p_offset: 0 },
    });
    expect(client.auth.admin.getUserById).toHaveBeenCalledWith("attendee-1");
    expect(result).toEqual({
      entries: [{
        id: "entry-1",
        attendeeId: "attendee-1",
        displayName: "Queue Member",
        position: 1,
        joinedAt: "2026-09-01T00:00:00Z",
        state: "queued",
        effectiveDeadline: null,
        override: { by: "coordinator-1", at: "2026-09-02T00:00:00Z", reason: "priority" },
        eligible: true,
      }],
      total: 1,
      queued: 1,
      offered: 0,
      autoOfferEnabled: true,
      serverTime: "2026-10-12T03:00:00Z",
      limit: 25,
      offset: 0,
    });
    expect(JSON.stringify(result)).not.toMatch(/email|phone|registration_data|private/i);
  });

  test("fails explicitly when Auth cannot resolve a display name instead of returning contact details", async () => {
    const { client } = makeClient({
      queueResult: {
        data: {
          outcome: "found",
          entries: [{ id: "entry-1", attendee_id: "attendee-1" }],
          total: 1,
          queued: 1,
          offered: 0,
          auto_offer_enabled: true,
          server_time: "2026-10-12T03:00:00Z",
        },
        error: null,
      },
    });
    client.auth.admin.getUserById.mockResolvedValueOnce({
      data: { user: null },
      error: new Error("Auth unavailable"),
    });
    const service = createWaitlistCoordinatorService(client);

    await expect(service.getCoordinatorWaitlist(EVENT, { limit: 50, offset: 0 }))
      .rejects.toThrow("Auth unavailable");
  });

  test("toggle and manual promotion pass the verified coordinator id to their database routines", async () => {
    const { client, calls } = makeClient();
    const service = createWaitlistCoordinatorService(client);

    await service.setAutoOffers(EVENT, false, "coordinator-1");
    await service.promoteEntry(EVENT, "entry-1", "coordinator-1", "Accessibility");

    expect(calls).toEqual([
      {
        name: "set_event_waitlist_auto_offers",
        args: {
          p_event_id: EVENT.id,
          p_enabled: false,
          p_actor_id: "coordinator-1",
        },
      },
      {
        name: "promote_waitlist_entry",
        args: {
          p_event_id: EVENT.id,
          p_entry_id: "entry-1",
          p_actor_id: "coordinator-1",
          p_reason: "Accessibility",
        },
      },
    ]);
  });

  test("database failures are surfaced instead of returned as empty queue or success", async () => {
    const { client } = makeClient({
      queueResult: { data: null, error: new Error("database unavailable") },
    });
    const service = createWaitlistCoordinatorService(client);

    await expect(service.getCoordinatorWaitlist(EVENT, { limit: 50, offset: 0 }))
      .rejects.toThrow("database unavailable");
  });
});
