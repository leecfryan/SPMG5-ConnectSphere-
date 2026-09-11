const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const createApp = require("../../src/app");

// ---------------------------------------------------------------------------
// Fake Supabase data client
//
// Intercepts the fluent query builder and resolves to whatever the per-table
// handler returns. The `terminal` field tells the handler which method ended
// the chain: "maybeSingle", "single", or "await" (direct await, used by the
// list query).
// ---------------------------------------------------------------------------

function makeDataClient(tables = {}) {
  return {
    from(table) {
      const q = { table, filters: [] };
      const resolve = (terminal) => {
        const fn = tables[table];
        return Promise.resolve(fn ? fn({ ...q, terminal }) : { data: null, error: null });
      };
      const b = {
        select(s) { q.select = s; return b; },
        eq(col, val) { q.filters.push([col, val]); return b; },
        order(col, opts) { q.order = { col, ...opts }; return b; },
        insert(data) { q.insert = data; return b; },
        update(data) { q.update = data; return b; },
        single() { return resolve("single"); },
        maybeSingle() { return resolve("maybeSingle"); },
        // Direct await (e.g. the list query that has no terminal method)
        then(onFulfilled, onRejected) {
          return resolve("await").then(onFulfilled, onRejected);
        },
      };
      return b;
    },
  };
}

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

const ATTENDEE = {
  id: "attendee-user-id",
  email: "attendee@example.com",
  app_metadata: { roles: ["attendee"] },
  user_metadata: { full_name: "Test Attendee" },
};

function validAuth(user = ATTENDEE) {
  return async () => ({ data: { user }, error: null });
}

async function setup(t, { getUser, tables } = {}) {
  const app = createApp({
    authClient: { auth: { getUser: getUser ?? validAuth() } },
    dataClient: makeDataClient(tables ?? {}),
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_test",
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return "http://127.0.0.1:" + server.address().port;
}

const AUTH = { Authorization: "Bearer valid" };
const JSON_HEADERS = { ...AUTH, "Content-Type": "application/json" };

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const APPROVED_EVENT = {
  id: "event-approved",
  name: "Test Event",
  status: "APPROVED",
  proposed_start: "2026-10-01T10:00:00Z",
  description: "An approved event.",
};

const DRAFT_EVENT = { id: "event-draft", name: "Draft Event", status: "DRAFT" };

const REGISTRATION = {
  id: "reg-1",
  event_id: "event-approved",
  attendee_id: "attendee-user-id",
  status: "pending",
  registration_data: null,
  created_at: "2026-09-11T10:00:00Z",
  updated_at: "2026-09-11T10:00:00Z",
  events: { name: "Test Event", proposed_start: "2026-10-01T10:00:00Z" },
};

// ---------------------------------------------------------------------------
// GET /api/events
// ---------------------------------------------------------------------------

test("GET /api/events: returns approved events", async (t) => {
  const base = await setup(t, {
    tables: { events: () => ({ data: [APPROVED_EVENT], error: null }) },
  });
  const res = await fetch(base + "/api/events", { headers: AUTH });
  assert.equal(res.status, 200);
  const { events } = await res.json();
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Test Event");
  assert.equal(events[0].status, "APPROVED");
});

test("GET /api/events: returns empty array when no approved events exist", async (t) => {
  const base = await setup(t, {
    tables: { events: () => ({ data: [], error: null }) },
  });
  const res = await fetch(base + "/api/events", { headers: AUTH });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).events, []);
});

test("GET /api/events: returns empty array when events table does not exist yet", async (t) => {
  const base = await setup(t, {
    tables: { events: () => ({ data: null, error: { code: "42P01", message: "table not found" } }) },
  });
  const res = await fetch(base + "/api/events", { headers: AUTH });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).events, []);
});

test("GET /api/events: returns 500 on unexpected DB error", async (t) => {
  const base = await setup(t, {
    tables: { events: () => ({ data: null, error: { message: "connection lost" } }) },
  });
  const res = await fetch(base + "/api/events", { headers: AUTH });
  assert.equal(res.status, 500);
});

test("GET /api/events: requires authentication", async (t) => {
  const base = await setup(t);
  assert.equal((await fetch(base + "/api/events")).status, 401);
});

// ---------------------------------------------------------------------------
// GET /api/events/:eventId
// ---------------------------------------------------------------------------

test("GET /api/events/:eventId: returns an approved event", async (t) => {
  const base = await setup(t, {
    tables: { events: () => ({ data: APPROVED_EVENT, error: null }) },
  });
  const res = await fetch(base + "/api/events/event-approved", { headers: AUTH });
  assert.equal(res.status, 200);
  const { event } = await res.json();
  assert.equal(event.name, "Test Event");
  assert.equal(event.status, "APPROVED");
});

test("GET /api/events/:eventId: returns 404 for a non-existent event", async (t) => {
  const base = await setup(t, {
    tables: { events: () => ({ data: null, error: null }) },
  });
  const res = await fetch(base + "/api/events/nonexistent", { headers: AUTH });
  assert.equal(res.status, 404);
});

test("GET /api/events/:eventId: returns 404 for a draft event (status filter excludes it)", async (t) => {
  // The query includes .eq("status", "APPROVED"), so Supabase returns null for a DRAFT event
  const base = await setup(t, {
    tables: { events: () => ({ data: null, error: null }) },
  });
  const res = await fetch(base + "/api/events/event-draft", { headers: AUTH });
  assert.equal(res.status, 404);
});

test("GET /api/events/:eventId: returns 500 on DB error", async (t) => {
  const base = await setup(t, {
    tables: { events: () => ({ data: null, error: { message: "db error" } }) },
  });
  const res = await fetch(base + "/api/events/event-approved", { headers: AUTH });
  assert.equal(res.status, 500);
});

test("GET /api/events/:eventId: requires authentication", async (t) => {
  const base = await setup(t);
  assert.equal((await fetch(base + "/api/events/event-approved")).status, 401);
});

// ---------------------------------------------------------------------------
// POST /api/registrations
// ---------------------------------------------------------------------------

test("POST /api/registrations: submits a valid registration", async (t) => {
  const base = await setup(t, {
    tables: {
      events: () => ({ data: APPROVED_EVENT, error: null }),
      registrations: (q) => {
        if (q.terminal === "maybeSingle") return { data: null, error: null }; // no duplicate
        if (q.terminal === "single") return { data: REGISTRATION, error: null }; // insert result
      },
    },
  });
  const res = await fetch(base + "/api/registrations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ eventId: "event-approved" }),
  });
  assert.equal(res.status, 201);
  const { registration } = await res.json();
  assert.equal(registration.event_id, "event-approved");
  assert.equal(registration.attendee_id, "attendee-user-id");
  assert.equal(registration.status, "pending");
});

test("POST /api/registrations: stores supplied registrationData in the row", async (t) => {
  const regData = { name: "Alice", dietaryRequirements: "vegan" };
  const base = await setup(t, {
    tables: {
      events: () => ({ data: APPROVED_EVENT, error: null }),
      registrations: (q) => {
        if (q.terminal === "maybeSingle") return { data: null, error: null };
        if (q.terminal === "single") {
          assert.deepEqual(q.insert.registration_data, regData);
          return { data: { ...REGISTRATION, registration_data: regData }, error: null };
        }
      },
    },
  });
  const res = await fetch(base + "/api/registrations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ eventId: "event-approved", registrationData: regData }),
  });
  assert.equal(res.status, 201);
  assert.deepEqual((await res.json()).registration.registration_data, regData);
});

test("POST /api/registrations: rejects missing eventId", async (t) => {
  const base = await setup(t);
  const res = await fetch(base + "/api/registrations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("POST /api/registrations: rejects non-string eventId", async (t) => {
  const base = await setup(t);
  const res = await fetch(base + "/api/registrations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ eventId: 123 }),
  });
  assert.equal(res.status, 400);
});

test("POST /api/registrations: returns 404 for a non-existent event", async (t) => {
  const base = await setup(t, {
    tables: { events: () => ({ data: null, error: null }) },
  });
  const res = await fetch(base + "/api/registrations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ eventId: "nonexistent" }),
  });
  assert.equal(res.status, 404);
});

test("POST /api/registrations: rejects registration for a non-APPROVED event", async (t) => {
  const base = await setup(t, {
    tables: { events: () => ({ data: DRAFT_EVENT, error: null }) },
  });
  const res = await fetch(base + "/api/registrations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ eventId: "event-draft" }),
  });
  assert.equal(res.status, 409);
  assert.match((await res.json()).message, /not open/);
});

test("POST /api/registrations: rejects a duplicate registration for the same event", async (t) => {
  const base = await setup(t, {
    tables: {
      events: () => ({ data: APPROVED_EVENT, error: null }),
      registrations: (q) => {
        if (q.terminal === "maybeSingle") return { data: { id: "existing-reg" }, error: null };
      },
    },
  });
  const res = await fetch(base + "/api/registrations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ eventId: "event-approved" }),
  });
  assert.equal(res.status, 409);
  assert.match((await res.json()).message, /already registered/);
});

test("POST /api/registrations: requires authentication", async (t) => {
  const base = await setup(t);
  const res = await fetch(base + "/api/registrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId: "event-approved" }),
  });
  assert.equal(res.status, 401);
});

test("POST /api/registrations: returns 500 on DB error during event check", async (t) => {
  const base = await setup(t, {
    tables: { events: () => ({ data: null, error: { message: "db error" } }) },
  });
  const res = await fetch(base + "/api/registrations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ eventId: "event-approved" }),
  });
  assert.equal(res.status, 500);
});

test("POST /api/registrations: returns 500 on DB error during insert", async (t) => {
  const base = await setup(t, {
    tables: {
      events: () => ({ data: APPROVED_EVENT, error: null }),
      registrations: (q) => {
        if (q.terminal === "maybeSingle") return { data: null, error: null };
        if (q.terminal === "single") return { data: null, error: { message: "insert failed" } };
      },
    },
  });
  const res = await fetch(base + "/api/registrations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ eventId: "event-approved" }),
  });
  assert.equal(res.status, 500);
});

// ---------------------------------------------------------------------------
// GET /api/registrations/me
// ---------------------------------------------------------------------------

test("GET /api/registrations/me: returns the attendee's own registrations", async (t) => {
  const base = await setup(t, {
    tables: { registrations: () => ({ data: [REGISTRATION], error: null }) },
  });
  const res = await fetch(base + "/api/registrations/me", { headers: AUTH });
  assert.equal(res.status, 200);
  const { registrations } = await res.json();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, "reg-1");
  assert.equal(registrations[0].attendee_id, "attendee-user-id");
});

test("GET /api/registrations/me: returns empty array when attendee has no registrations", async (t) => {
  const base = await setup(t, {
    tables: { registrations: () => ({ data: [], error: null }) },
  });
  const res = await fetch(base + "/api/registrations/me", { headers: AUTH });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).registrations, []);
});

test("GET /api/registrations/me: includes event name and date from join", async (t) => {
  const base = await setup(t, {
    tables: { registrations: () => ({ data: [REGISTRATION], error: null }) },
  });
  const { registrations } = await (await fetch(base + "/api/registrations/me", { headers: AUTH })).json();
  assert.equal(registrations[0].events.name, "Test Event");
  assert.ok(registrations[0].events.proposed_start);
});

test("GET /api/registrations/me: requires authentication", async (t) => {
  const base = await setup(t);
  assert.equal((await fetch(base + "/api/registrations/me")).status, 401);
});

test("GET /api/registrations/me: returns 500 on DB error", async (t) => {
  const base = await setup(t, {
    tables: { registrations: () => ({ data: null, error: { message: "db error" } }) },
  });
  assert.equal((await fetch(base + "/api/registrations/me", { headers: AUTH })).status, 500);
});

// ---------------------------------------------------------------------------
// GET /api/registrations/me/:registrationId
// ---------------------------------------------------------------------------

test("GET /api/registrations/me/:id: returns the attendee's own registration", async (t) => {
  const base = await setup(t, {
    tables: { registrations: () => ({ data: REGISTRATION, error: null }) },
  });
  const res = await fetch(base + "/api/registrations/me/reg-1", { headers: AUTH });
  assert.equal(res.status, 200);
  const { registration } = await res.json();
  assert.equal(registration.id, "reg-1");
  assert.equal(registration.status, "pending");
});

test("GET /api/registrations/me/:id: returns 404 for another attendee's registration", async (t) => {
  // The query filters by attendee_id = req.user.id; Supabase returns null when it does not match
  const base = await setup(t, {
    tables: { registrations: () => ({ data: null, error: null }) },
  });
  const res = await fetch(base + "/api/registrations/me/other-attendees-reg", { headers: AUTH });
  assert.equal(res.status, 404);
});

test("GET /api/registrations/me/:id: returns 404 for a non-existent registration", async (t) => {
  const base = await setup(t, {
    tables: { registrations: () => ({ data: null, error: null }) },
  });
  assert.equal((await fetch(base + "/api/registrations/me/nonexistent", { headers: AUTH })).status, 404);
});

test("GET /api/registrations/me/:id: requires authentication", async (t) => {
  const base = await setup(t);
  assert.equal((await fetch(base + "/api/registrations/me/reg-1")).status, 401);
});

test("GET /api/registrations/me/:id: returns 500 on DB error", async (t) => {
  const base = await setup(t, {
    tables: { registrations: () => ({ data: null, error: { message: "db error" } }) },
  });
  assert.equal((await fetch(base + "/api/registrations/me/reg-1", { headers: AUTH })).status, 500);
});

// ---------------------------------------------------------------------------
// PATCH /api/registrations/:registrationId/withdraw
// ---------------------------------------------------------------------------

test("PATCH /withdraw: withdraws an active registration", async (t) => {
  const withdrawn = { ...REGISTRATION, status: "withdrawn" };
  const base = await setup(t, {
    tables: {
      registrations: (q) => {
        if (q.terminal === "maybeSingle") return { data: REGISTRATION, error: null };
        if (q.terminal === "single") return { data: withdrawn, error: null };
      },
    },
  });
  const res = await fetch(base + "/api/registrations/reg-1/withdraw", {
    method: "PATCH",
    headers: AUTH,
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).registration.status, "withdrawn");
});

test("PATCH /withdraw: sets only status to withdrawn, does not delete the row", async (t) => {
  const withdrawn = { ...REGISTRATION, status: "withdrawn" };
  const base = await setup(t, {
    tables: {
      registrations: (q) => {
        if (q.terminal === "maybeSingle") return { data: REGISTRATION, error: null };
        if (q.terminal === "single") {
          assert.deepEqual(q.update, { status: "withdrawn" });
          return { data: withdrawn, error: null };
        }
      },
    },
  });
  const res = await fetch(base + "/api/registrations/reg-1/withdraw", {
    method: "PATCH",
    headers: AUTH,
  });
  assert.equal(res.status, 200);
  const { registration } = await res.json();
  assert.equal(registration.event_id, "event-approved"); // row still associated with event
});

test("PATCH /withdraw: returns 404 for another attendee's registration", async (t) => {
  // attendee_id filter means Supabase returns null for rows not owned by this user
  const base = await setup(t, {
    tables: { registrations: () => ({ data: null, error: null }) },
  });
  const res = await fetch(base + "/api/registrations/other-reg/withdraw", {
    method: "PATCH",
    headers: AUTH,
  });
  assert.equal(res.status, 404);
});

test("PATCH /withdraw: returns 404 for a non-existent registration", async (t) => {
  const base = await setup(t, {
    tables: { registrations: () => ({ data: null, error: null }) },
  });
  assert.equal((await fetch(base + "/api/registrations/nonexistent/withdraw", { method: "PATCH", headers: AUTH })).status, 404);
});

test("PATCH /withdraw: returns 409 for an already-withdrawn registration", async (t) => {
  const base = await setup(t, {
    tables: {
      registrations: () => ({ data: { ...REGISTRATION, status: "withdrawn" }, error: null }),
    },
  });
  const res = await fetch(base + "/api/registrations/reg-1/withdraw", {
    method: "PATCH",
    headers: AUTH,
  });
  assert.equal(res.status, 409);
  assert.match((await res.json()).message, /already been withdrawn/);
});

test("PATCH /withdraw: requires authentication", async (t) => {
  const base = await setup(t);
  assert.equal((await fetch(base + "/api/registrations/reg-1/withdraw", { method: "PATCH" })).status, 401);
});

test("PATCH /withdraw: returns 500 on DB error during fetch", async (t) => {
  const base = await setup(t, {
    tables: { registrations: () => ({ data: null, error: { message: "db error" } }) },
  });
  assert.equal((await fetch(base + "/api/registrations/reg-1/withdraw", { method: "PATCH", headers: AUTH })).status, 500);
});

test("PATCH /withdraw: returns 500 on DB error during update", async (t) => {
  const base = await setup(t, {
    tables: {
      registrations: (q) => {
        if (q.terminal === "maybeSingle") return { data: REGISTRATION, error: null };
        if (q.terminal === "single") return { data: null, error: { message: "update failed" } };
      },
    },
  });
  assert.equal((await fetch(base + "/api/registrations/reg-1/withdraw", { method: "PATCH", headers: AUTH })).status, 500);
});
