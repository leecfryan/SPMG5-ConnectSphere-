import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

const createApp = require("../../src/app");
const { createClient } = require("@supabase/supabase-js");

const live = Boolean(
  process.env.RUN_LIVE_WAITLIST_TESTS === "true" &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SECRET_KEY &&
  process.env.SUPABASE_PUBLISHABLE_KEY
);

describe.skipIf(!live)("Waitlist story against the real Supabase database", () => {
  let admin;
  let authClient;
  let baseUrl;
  let closeServer;
  let organiser;
  let coordinator;
  let attendees;
  let tokens;
  let eventId;

  beforeAll(async () => {
    admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    authClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );

    const app = createApp({
      authClient,
      dataClient: admin,
      supabaseUrl: process.env.SUPABASE_URL,
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    closeServer = () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });

    const createAccount = async (roles) => {
      const email = `waitlist-${randomUUID()}@example.test`;
      const password = `${randomUUID()}-Aa1!`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { roles },
      });
      if (error) throw new Error(`Could not create live waitlist test account: ${error.message}`);
      return { id: data.user.id, email, password };
    };

    [organiser, coordinator, ...attendees] = await Promise.all([
      createAccount(["event_organiser"]),
      createAccount(["event_coordinator"]),
      createAccount(["attendee"]),
      createAccount(["attendee"]),
      createAccount(["attendee"]),
    ]);

    const signIn = async (account) => {
      const { data, error } = await authClient.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      if (error) throw new Error(`Could not sign in live waitlist test account: ${error.message}`);
      return data.session.access_token;
    };
    tokens = {
      coordinator: await signIn(coordinator),
      attendees: await Promise.all(attendees.map(signIn)),
    };

    const tableCheck = await admin
      .from("event_waitlist_entries")
      .select("id")
      .limit(0);
    if (tableCheck.error) throw new Error(`Waitlist table is unavailable: ${tableCheck.error.message}`);
    const functionCheck = await admin.rpc("enqueue_waitlist_if_full", {
      p_event_id: null,
      p_attendee_id: null,
    });
    if (functionCheck.error || functionCheck.data?.outcome !== "invalid_request") {
      throw new Error(`Waitlist enqueue function is unavailable: ${functionCheck.error?.message ?? "unexpected response"}`);
    }
  }, 60_000);

  async function createTemporaryEvent({
    capacity = 1,
    enrolled = capacity,
    status = "APPROVED",
    registrationStart = null,
    registrationEnd = null,
  } = {}) {
    eventId = randomUUID();
    const { error } = await admin.from("events").insert({
      id: eventId,
      name: `Waitlist live test ${eventId}`,
      status,
      purpose: "Temporary live waitlist test",
      description: "Disposable event created and removed by waitlist.userStory.test.js",
      start_time: "2099-10-10T10:00:00Z",
      end_time: "2099-10-10T12:00:00Z",
      expected_attendance: capacity,
      enrolled_attendees: enrolled,
      registration_fields: [],
      registration_start: registrationStart,
      registration_end: registrationEnd,
      organiser_id: organiser.id,
      coordinator_id: coordinator.id,
    });
    if (error) throw new Error(`Could not create live waitlist test event: ${error.message}`);
  }

  async function updateTemporaryEvent({
    capacity,
    enrolled,
    status,
    registrationStart,
    registrationEnd,
  } = {}) {
    const fields = {};
    if (capacity !== undefined) fields.expected_attendance = capacity;
    if (enrolled !== undefined) fields.enrolled_attendees = enrolled;
    if (status !== undefined) fields.status = status;
    if (registrationStart !== undefined) fields.registration_start = registrationStart;
    if (registrationEnd !== undefined) fields.registration_end = registrationEnd;
    const { error } = await admin.from("events").update(fields).eq("id", eventId);
    if (error) throw new Error(`Could not update live waitlist test event: ${error.message}`);
  }

  async function api(token, pathName, options = {}) {
    const response = await fetch(`${baseUrl}${pathName}`, {
      ...options,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
    };
  }

  async function readEntries() {
    const { data, error } = await admin
      .from("event_waitlist_entries")
      .select("id, event_id, attendee_id, status, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw new Error(`Could not verify live waitlist entries: ${error.message}`);
    return data;
  }

  async function createRegistration(attendeeIndex, status) {
    const { error } = await admin.from("registrations").insert({
      event_id: eventId,
      attendee_id: attendees[attendeeIndex].id,
      status,
      registration_data: null,
    });
    if (error) throw new Error(`Could not create live registration: ${error.message}`);
  }

  beforeEach(async () => {
    await createTemporaryEvent();
  });

  afterEach(async () => {
    if (!eventId) return;
    const currentEventId = eventId;
    const { error: waitlistError } = await admin
      .from("event_waitlist_entries")
      .delete()
      .eq("event_id", currentEventId);
    const { error: registrationsError } = await admin
      .from("registrations")
      .delete()
      .eq("event_id", currentEventId);
    const { error: eventError } = await admin.from("events").delete().eq("id", currentEventId);
    const cleanupErrors = [
      waitlistError && `waitlist: ${waitlistError.message}`,
      registrationsError && `registrations: ${registrationsError.message}`,
      eventError && `event: ${eventError.message}`,
    ].filter(Boolean);
    if (cleanupErrors.length) {
      throw new Error(`Could not clean live waitlist test event (${cleanupErrors.join("; ")})`);
    }
    eventId = undefined;
  });

  test("AC1: full event joins successfully; non-full and missing events are refused", async () => {
    const joined = await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" });
    expect(joined.status).toBe(201);
    expect(joined.body.position).toBe(1);
    expect(joined.body.entry.event_id).toBe(eventId);

    await updateTemporaryEvent({ capacity: 1, enrolled: 0 });
    const notFull = await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" });
    expect(notFull.status).toBe(409);
    expect((await api(tokens.attendees[0], `/api/waitlist/${randomUUID()}`, { method: "POST" })).status).toBe(404);
  });

  test.each([
    ["unapproved", { status: "DRAFT" }],
    ["before registration opens", { registrationStart: "2099-01-01T00:00:00Z" }],
    ["after registration closes", { registrationEnd: "2000-01-01T00:00:00Z" }],
  ])("AC1: joining an event %s is refused", async (_label, fields) => {
    await updateTemporaryEvent(fields);
    expect((await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" })).status).toBe(409);
  });

  test.each(["pending", "confirmed"])("AC1: %s registration blocks joining; withdrawn registration does not", async (status) => {
    await createRegistration(0, status);
    expect((await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" })).status).toBe(409);

    await admin.from("registrations").delete().eq("event_id", eventId);
    await createRegistration(0, "withdrawn");
    expect((await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" })).status).toBe(201);
  });

  test("AC2: sequential and concurrent duplicate joins leave one active row", async () => {
    expect((await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" })).status).toBe(201);
    expect((await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" })).status).toBe(409);
    expect(await readEntries()).toHaveLength(1);

    await admin.from("event_waitlist_entries").delete().eq("event_id", eventId);
    const results = await Promise.all([
      api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" }),
      api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" }),
      api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" }),
    ]);
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(2);
    expect(await readEntries()).toHaveLength(1);
  });

  test("AC3: position follows FIFO and shifts after withdrawal; non-members receive 404", async () => {
    for (const token of tokens.attendees) {
      expect((await api(token, `/api/waitlist/${eventId}`, { method: "POST" })).status).toBe(201);
    }
    const positions = await Promise.all(tokens.attendees.map(async (token) => {
      const result = await api(token, `/api/waitlist/${eventId}`);
      return result.body.position;
    }));
    expect(positions).toEqual([1, 2, 3]);

    expect((await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "DELETE" })).status).toBe(204);
    const shifted = await Promise.all(tokens.attendees.slice(1).map(async (token) => {
      const result = await api(token, `/api/waitlist/${eventId}`);
      return result.body.position;
    }));
    expect(shifted).toEqual([1, 2]);
    expect((await api(tokens.attendees[0], `/api/waitlist/${eventId}`)).status).toBe(404);
  });

  test("AC4: withdrawal deletes the row; repeat withdrawal is 404 and rejoin goes to the back", async () => {
    await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" });
    await api(tokens.attendees[1], `/api/waitlist/${eventId}`, { method: "POST" });
    expect((await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "DELETE" })).status).toBe(204);
    expect((await readEntries()).map((row) => row.attendee_id)).toEqual([attendees[1].id]);
    expect((await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "DELETE" })).status).toBe(404);

    expect((await api(tokens.attendees[0], `/api/waitlist/${eventId}`, { method: "POST" })).status).toBe(201);
    expect((await api(tokens.attendees[1], `/api/waitlist/${eventId}`)).body.position).toBe(1);
    expect((await api(tokens.attendees[0], `/api/waitlist/${eventId}`)).body.position).toBe(2);
  });

  test("Auth: unauthenticated and wrong-role callers are denied; attendees cannot access another user's entry", async () => {
    expect((await api(null, `/api/waitlist/${eventId}`, { method: "POST" })).status).toBe(401);
    expect((await api(tokens.coordinator, `/api/waitlist/${eventId}`, { method: "POST" })).status).toBe(403);

    await api(tokens.attendees[0], `/api/waitlist/${eventId}`, {
      method: "POST",
      body: JSON.stringify({ attendee_id: attendees[1].id }),
    });
    expect((await api(tokens.attendees[1], `/api/waitlist/${eventId}`)).status).toBe(404);
    expect((await api(tokens.attendees[1], `/api/waitlist/${eventId}`, { method: "DELETE" })).status).toBe(404);
    expect((await readEntries()).map((row) => row.attendee_id)).toEqual([attendees[0].id]);
  });

  afterAll(async () => {
    try {
      if (eventId) {
        const { error } = await admin.from("events").delete().eq("id", eventId);
        if (error) throw new Error(`Could not clean live waitlist test event: ${error.message}`);
      }
      for (const account of [organiser, coordinator, ...(attendees ?? [])].filter(Boolean)) {
        const { error } = await admin.auth.admin.deleteUser(account.id);
        if (error) throw new Error(`Could not clean live waitlist test account: ${error.message}`);
      }
    } finally {
      if (closeServer) await closeServer();
    }
  });
});
