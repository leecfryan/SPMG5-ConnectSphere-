import { test, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

// The modules under test are CommonJS. Loading them with createRequire keeps
// them in Node's own module graph, so the object a test holds is the same one
// the source closes over; a plain ESM import would hand back a second copy and
// a spy set on it would never be seen by the code under test.
const require = createRequire(import.meta.url);
const { stubSupabase } = require("../../helpers/stubSupabase");

// Records the row handed to insert() and echoes it back, standing in for
// supabase.from(TABLE).insert(row).select().single().
let inserted;
stubSupabase({
  from: () => ({
    insert(row) {
      inserted = row;
      return {
        select: () => ({
          single: async () => ({ data: { id: "evt-1", ...row }, error: null }),
        }),
      };
    },
  }),
});

const repository = require("../../../src/modules/events/events.repository");

beforeEach(() => {
  inserted = undefined;
});

test("SCRUM-49: createSubmitted inserts as SUBMITTED with submitted_at and the organiser", async () => {
  const at = "2026-09-15T02:00:00.000Z";
  const event = await repository.createSubmitted({ name: "Gala" }, "org-1", at);

  expect(inserted.status).toBe("SUBMITTED");
  expect(inserted.submitted_at).toBe(at);
  expect(inserted.organiser_id).toBe("org-1");
  expect(event.id).toBe("evt-1");
});

test("SCRUM-50: createSubmitted defaults submitted_at to now", async () => {
  const before = Date.now();
  await repository.createSubmitted({ name: "Gala" }, "org-1");
  const stamped = new Date(inserted.submitted_at).getTime();
  expect(stamped).toBeGreaterThanOrEqual(before);
  expect(stamped).toBeLessThanOrEqual(Date.now());
});

// The guarantee that matters: ownership and lifecycle columns come from the
// server, whatever the caller's fields say.
test("SCRUM-25 design: status, owner and coordinator in the fields are ignored", async () => {
  await repository.createSubmitted(
    {
      name: "Gala",
      status: "APPROVED",
      submitted_at: "1999-01-01T00:00:00.000Z",
      organiser_id: "someone-else",
      coordinator_id: "self-assigned",
      id: "chosen-id",
    },
    "org-1",
    "2026-09-15T02:00:00.000Z",
  );

  expect(inserted.status).toBe("SUBMITTED");
  expect(inserted.submitted_at).toBe("2026-09-15T02:00:00.000Z");
  expect(inserted.organiser_id).toBe("org-1");
  expect("coordinator_id" in inserted).toBe(false);
  expect("id" in inserted).toBe(false);
});

test("SCRUM-25 design: a Supabase error is thrown with the action named", async () => {
  stubSupabase({
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error: { message: "boom" } }),
        }),
      }),
    }),
  });
  // Re-require against the new stub.
  delete require.cache[require.resolve("../../../src/modules/events/events.repository")];
  const fresh = require("../../../src/modules/events/events.repository");

  await expect(fresh.createSubmitted({ name: "Gala" }, "org-1")).rejects.toThrow(
    /createSubmitted failed - boom/,
  );
});
