import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { claimRegistrationSeat } = require("../../../src/modules/registrations/registrationSeats");

describe("registration seat reservations", () => {
  test("an offered seat counts against event capacity", async () => {
    const result = await claimRegistrationSeat(
      { from() { throw new Error("a full event must not be updated"); } },
      "event-1",
      { enrolled_attendees: 0, expected_attendance: 1 },
      1,
    );

    expect(result).toEqual({ status: "full" });
  });

  test("a seat remains claimable after reserving one of two places", async () => {
    const event = { id: "event-1", enrolled_attendees: 0 };
    const client = {
      from(table) {
        expect(table).toBe("events");
        const query = { filters: [] };
        const builder = {
          update(values) {
            query.values = values;
            return builder;
          },
          eq(column, value) {
            query.filters.push([column, value]);
            return builder;
          },
          select() {
            return builder;
          },
          maybeSingle() {
            const matches = query.filters.every(([column, value]) => event[column] === value);
            if (!matches) return Promise.resolve({ data: null, error: null });
            Object.assign(event, query.values);
            return Promise.resolve({
              data: { id: event.id, enrolled_attendees: event.enrolled_attendees },
              error: null,
            });
          },
        };
        return builder;
      },
    };

    const result = await claimRegistrationSeat(
      client,
      "event-1",
      { enrolled_attendees: 0, expected_attendance: 2 },
      1,
    );

    expect(result).toEqual({ status: "claimed", enrolled: 1 });
    expect(event.enrolled_attendees).toBe(1);
  });
});
