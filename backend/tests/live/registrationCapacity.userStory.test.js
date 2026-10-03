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
  process.env.RUN_LIVE_REGISTRATION_CAPACITY_TESTS === "true" &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SECRET_KEY &&
  process.env.SUPABASE_PUBLISHABLE_KEY &&
  process.env.SEED_USER_PASSWORD
);

const ORGANISER = "organiser.demo@example.com";
const ATTENDEES = ["attendee1.demo@example.com", "attendee2.demo@example.com"];

describe.skipIf(!live)("Registration capacity against Supabase", () => {
  let admin;
  let authClient;
  let baseUrl;
  let closeServer;
  let organiserId;
  let attendeeTokens;
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

    const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (usersError) throw new Error(`Could not load live test accounts: ${usersError.message}`);
    const userId = (email) => {
      const user = users.users.find((candidate) => candidate.email?.toLowerCase() === email);
      if (!user) throw new Error(`Required live test account is missing: ${email}`);
      return user.id;
    };
    organiserId = userId(ORGANISER);

    attendeeTokens = {};
    for (const email of ATTENDEES) {
      const { data, error } = await authClient.auth.signInWithPassword({
        email,
        password: process.env.SEED_USER_PASSWORD,
      });
      if (error) throw new Error(`Could not sign in live test account ${email}: ${error.message}`);
      attendeeTokens[email] = data.session.access_token;
    }
  }, 60_000);

  async function createTemporaryEvent(capacity) {
    eventId = randomUUID();
    const { error } = await admin.from("events").insert({
      id: eventId,
      name: `Capacity live test ${eventId}`,
      status: "APPROVED",
      purpose: "Temporary automated registration capacity test",
      description: "Disposable event created and removed by registrationCapacity.userStory.test.js",
      start_time: "2099-10-10T10:00:00Z",
      end_time: "2099-10-10T12:00:00Z",
      expected_attendance: capacity,
      enrolled_attendees: 0,
      registration_fields: [],
      organiser_id: organiserId,
    });
    if (error) throw new Error(`Could not create temporary live test event: ${error.message}`);
  }

  async function api(token, pathName, options = {}) {
    const response = await fetch(`${baseUrl}${pathName}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    return { status: response.status, body: await response.json() };
  }

  async function register(token) {
    return api(token, "/api/registrations", {
      method: "POST",
      body: JSON.stringify({ eventId }),
    });
  }

  async function readEvent() {
    const { data, error } = await admin
      .from("events")
      .select("id, enrolled_attendees, expected_attendance")
      .eq("id", eventId)
      .single();
    if (error) throw new Error(`Could not verify temporary event counter: ${error.message}`);
    return data;
  }

  async function readRegistrations() {
    const { data, error } = await admin
      .from("registrations")
      .select("id, attendee_id, status")
      .eq("event_id", eventId);
    if (error) throw new Error(`Could not verify temporary registrations: ${error.message}`);
    return data;
  }

  beforeEach(async () => {
    await createTemporaryEvent(2);
  });

  afterEach(async () => {
    if (!eventId) return;
    const currentEventId = eventId;
    eventId = undefined;

    const { error: registrationsError } = await admin
      .from("registrations")
      .delete()
      .eq("event_id", currentEventId);
    const { error: eventError } = await admin
      .from("events")
      .delete()
      .eq("id", currentEventId);

    const cleanupErrors = [
      registrationsError && `registrations: ${registrationsError.message}`,
      eventError && `event: ${eventError.message}`,
    ].filter(Boolean);
    if (cleanupErrors.length) {
      throw new Error(`Could not clean temporary live test data (${cleanupErrors.join("; ")})`);
    }
  });

  test("the approved event list and detail expose the live count and cap", async () => {
    const listed = await api(attendeeTokens[ATTENDEES[0]], "/api/events");
    expect(listed.status).toBe(200);
    expect(listed.body.events.find((event) => event.id === eventId)).toMatchObject({
      enrolled_attendees: 0,
      expected_attendance: 2,
    });

    const detail = await api(attendeeTokens[ATTENDEES[0]], `/api/events/${eventId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.event).toMatchObject({
      enrolled_attendees: 0,
      expected_attendance: 2,
    });
  });

  test("a successful live registration increments the event counter once", async () => {
    const result = await register(attendeeTokens[ATTENDEES[0]]);

    expect(result.status).toBe(201);
    expect((await readEvent()).enrolled_attendees).toBe(1);
    expect(await readRegistrations()).toMatchObject([
      { attendee_id: expect.any(String), status: "pending" },
    ]);

    const detail = await api(attendeeTokens[ATTENDEES[0]], `/api/events/${eventId}`);
    expect(detail.body.event.enrolled_attendees).toBe(1);
  });

  test("a live registration is rejected at capacity", async () => {
    const first = await register(attendeeTokens[ATTENDEES[0]]);
    expect(first.status).toBe(201);

    const second = await register(attendeeTokens[ATTENDEES[1]]);
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/reached or exceeded capacity/);
    expect((await readEvent()).enrolled_attendees).toBe(1);
    expect(await readRegistrations()).toHaveLength(1);
  });

  test("parallel live requests cannot claim the final seat twice", async () => {
    const { error } = await admin
      .from("events")
      .update({ expected_attendance: 1 })
      .eq("id", eventId);
    if (error) throw new Error(`Could not configure the temporary event capacity: ${error.message}`);

    const results = await Promise.all([
      register(attendeeTokens[ATTENDEES[0]]),
      register(attendeeTokens[ATTENDEES[1]]),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await readEvent()).enrolled_attendees).toBe(1);
    expect(await readRegistrations()).toHaveLength(1);
  });

  test("withdrawing a live pending registration releases its seat", async () => {
    const registered = await register(attendeeTokens[ATTENDEES[0]]);
    expect(registered.status).toBe(201);

    const result = await api(
      attendeeTokens[ATTENDEES[0]],
      `/api/registrations/${registered.body.registration.id}/withdraw`,
      { method: "PATCH" },
    );

    expect(result.status).toBe(200);
    expect(result.body.registration.status).toBe("withdrawn");
    expect((await readEvent()).enrolled_attendees).toBe(0);
    expect(await readRegistrations()).toMatchObject([{ status: "withdrawn" }]);
  });

  afterAll(async () => {
    try {
      if (eventId && admin) {
        const currentEventId = eventId;
        eventId = undefined;
        const { error: registrationsError } = await admin
          .from("registrations")
          .delete()
          .eq("event_id", currentEventId);
        const { error: eventError } = await admin
          .from("events")
          .delete()
          .eq("id", currentEventId);
        const cleanupErrors = [
          registrationsError && `registrations: ${registrationsError.message}`,
          eventError && `event: ${eventError.message}`,
        ].filter(Boolean);
        if (cleanupErrors.length) {
          throw new Error(`Could not clean temporary live test data (${cleanupErrors.join("; ")})`);
        }
      }
    } finally {
      if (closeServer) await closeServer();
    }
  });
});
