import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { claimRegistrationSeatV2 } = require("../../../src/modules/registrations/registrationSeats");

describe("registration seat claim and waitlist race", () => {
  test("the locked claim rejects an offer created after the handler's initial event read", async () => {
    const state = { enrolled: 0, offeredSeats: 0, capacity: 1 };
    let claimAttempted = false;
    const client = {
      async rpc(name, args) {
        expect(name).toBe("claim_registration_seat_v2");
        expect(args).toEqual({ p_event_id: "event-1" });
        claimAttempted = true;

        state.offeredSeats = 1;
        if (state.enrolled + state.offeredSeats >= state.capacity) {
          return { data: { outcome: "full" }, error: null };
        }

        state.enrolled += 1;
        return {
          data: { outcome: "claimed", enrolled_attendees: state.enrolled },
          error: null,
        };
      },
    };

    const result = await claimRegistrationSeatV2(client, "event-1");

    expect(claimAttempted).toBe(true);
    expect(result).toEqual({ status: "full" });
    expect(state.enrolled + state.offeredSeats).toBeLessThanOrEqual(state.capacity);
  });
});
