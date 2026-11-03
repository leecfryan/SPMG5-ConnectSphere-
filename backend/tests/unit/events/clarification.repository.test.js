import { createRequire } from "node:module";
import { test, expect, vi } from "vitest";
const require = createRequire(import.meta.url);
const { stubSupabase } = require("../../helpers/stubSupabase");
const repository = require("../../../src/modules/events/events.repository");

test("[SCRUM-117-UNIT-003] return delegates the verified identity and message to the atomic RPC", async () => {
  const event = { id: "event", status: "CHANGES_REQUESTED" };
  const rpc = vi.fn(() => ({ maybeSingle: async () => ({ data: event, error: null }) }));
  stubSupabase({ rpc });
  expect(await repository.requestChanges("event", "coordinator", "Clarify")).toEqual(event);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("request_event_changes", { p_event_id: "event", p_coordinator_id: "coordinator", p_message: "Clarify" });
});

test("[SCRUM-117-UNIT-004] a lost state/assignment match returns no event and storage errors propagate", async () => {
  stubSupabase({ rpc: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) });
  expect(await repository.requestChanges("event", "coordinator", "Clarify")).toBeNull();
  stubSupabase({ rpc: () => ({ maybeSingle: async () => ({ data: null, error: { message: "failed" } }) }) });
  await expect(repository.requestChanges("event", "coordinator", "Clarify")).rejects.toThrow("requestChanges failed");
});
