// Acceptance tests for one user story, run against the real Supabase project:
//
//   "As an Event Organiser or Event Coordinator, I want to view appropriate
//    registration information for an event I manage so that I can understand
//    its registrations."
//
// This is the ONLY thing this file asserts. Each test names the acceptance
// criterion it covers, and nothing here checks an internal detail - no column
// list, no query shape, no filter string, no status constant. If a refactor
// changes how the answer is produced without changing the answer, these tests
// must not notice.
//
// Nothing about the data is hardcoded. Every expectation is derived from the
// database inside the test, so the file stays honest when the seed data changes
// and still fails when the endpoint disagrees with the database.
//
// The suite skips unless the root .env carries the Supabase keys and
// SEED_USER_PASSWORD, so `npm test` stays green on a machine - and in CI - that
// has no credentials.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

const createApp = require("../../src/app");
const { createManagedEventsService } = require("../../src/modules/managedEvents/managedEvents.service");
const { createClient } = require("@supabase/supabase-js");

const live = Boolean(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SECRET_KEY &&
  process.env.SUPABASE_PUBLISHABLE_KEY &&
  process.env.SEED_USER_PASSWORD
);

const ORGANISER = "organiser.demo@example.com";
const COORDINATOR = "coordinator.demo@example.com";
const ATTENDEE = "attendee1.demo@example.com";

// Ownership and submitted form data. Never a key in any response body.
const FORBIDDEN_KEYS = ["attendee_id", "registration_data", "organiser_id", "coordinator_id"];

describe.skipIf(!live)("My Events user story, against the real database", () => {
  let baseUrl;
  let close;
  let allEvents = [];
  let tokens = {};
  let ids = {};

  // Everything the caller manages, computed independently of the endpoint, so
  // a broken ownership filter cannot agree with itself.
  const manages = (userId) =>
    allEvents.filter((e) => e.organiser_id === userId || e.coordinator_id === userId);

  const managesNeither = () =>
    allEvents.filter(
      (e) => !manages(ids.organiser).some((x) => x.id === e.id)
        && !manages(ids.coordinator).some((x) => x.id === e.id)
    );

  beforeAll(async () => {
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const authClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );

    const app = createApp({
      authClient,
      managedEventsService: createManagedEventsService(admin),
      supabaseUrl: process.env.SUPABASE_URL,
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    close = () => new Promise((resolve) => server.close(resolve));

    // Real sign-in, so the app verifies a real JWT exactly as it does in
    // production rather than trusting a stubbed identity.
    const signIn = async (email) => {
      const { data, error } = await authClient.auth.signInWithPassword({
        email,
        password: process.env.SEED_USER_PASSWORD,
      });
      if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
      return data.session.access_token;
    };
    tokens = {
      organiser: await signIn(ORGANISER),
      coordinator: await signIn(COORDINATOR),
      attendee: await signIn(ATTENDEE),
    };

    const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (usersError) throw new Error(usersError.message);
    const idOf = (email) => {
      const user = users.users.find((u) => u.email === email);
      if (!user) throw new Error(`seed user missing: ${email}`);
      return user.id;
    };
    ids = {
      organiser: idOf(ORGANISER),
      coordinator: idOf(COORDINATOR),
      attendee: idOf(ATTENDEE),
    };

    const { data: events, error: eventsError } = await admin
      .from("events")
      .select(
        "id, name, status, start_time, end_time, enrolled_attendees, expected_attendance, organiser_id, coordinator_id"
      );
    if (eventsError) throw new Error(eventsError.message);
    allEvents = events;
  }, 60_000);

  async function api(token, urlPath) {
    const response = await fetch(`${baseUrl}${urlPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: await response.json() };
  }

  // -- AC1: Event Organisers can view registration information for the
  //        events they manage. ---------------------------------------------

  test("AC1 an Event Organiser sees every event they manage, and nothing else", async () => {
    const expected = manages(ids.organiser).map((e) => e.id).sort();
    expect(expected.length, "the organiser must manage at least one event").toBeGreaterThan(0);

    const { status, body } = await api(tokens.organiser, "/api/managed-events");

    expect(status).toBe(200);
    expect(body.events.map((e) => e.id).sort()).toEqual(expected);
  });

  test("AC1 an Event Organiser can open an event they manage and see its registration information", async () => {
    const target = manages(ids.organiser)[0];
    const row = allEvents.find((e) => e.id === target.id);

    const { status, body } = await api(tokens.organiser, `/api/managed-events/${target.id}`);

    expect(status).toBe(200);
    expect(body.summary).toMatchObject({
      id: target.id,
      name: row.name,
      status: row.status,
      enrolled: row.enrolled_attendees ?? 0,
      maxEnrollment: row.expected_attendance ?? null,
    });
    expect(typeof body.summary.waitingList).toBe("number");
  });

  // -- AC2: Event Coordinators can view registration information for the
  //        events they manage. ---------------------------------------------

  test("AC2 an Event Coordinator sees every event they manage, and nothing else", async () => {
    const expected = manages(ids.coordinator).map((e) => e.id).sort();
    expect(expected.length, "the coordinator must manage at least one event").toBeGreaterThan(0);

    const { status, body } = await api(tokens.coordinator, "/api/managed-events");

    expect(status).toBe(200);
    expect(body.events.map((e) => e.id).sort()).toEqual(expected);
  });

  test("AC2 an Event Coordinator can open an event they manage and see its registration information", async () => {
    const target = manages(ids.coordinator)[0];
    const row = allEvents.find((e) => e.id === target.id);

    const { status, body } = await api(tokens.coordinator, `/api/managed-events/${target.id}`);

    expect(status).toBe(200);
    expect(body.summary).toMatchObject({
      id: target.id,
      name: row.name,
      status: row.status,
      enrolled: row.enrolled_attendees ?? 0,
      maxEnrollment: row.expected_attendance ?? null,
    });
    expect(typeof body.summary.waitingList).toBe("number");
  });

  // -- AC3: Registration information for unrelated events is not exposed
  //        through this function. ------------------------------------------

  test("AC3 registration information for an event the caller does not manage is refused", async () => {
    const unrelated = managesNeither();
    expect(unrelated.length, "an unrelated event must exist").toBeGreaterThan(0);
    const target = unrelated[0];

    const forOrganiser = await api(tokens.organiser, `/api/managed-events/${target.id}`);
    const forCoordinator = await api(tokens.coordinator, `/api/managed-events/${target.id}`);

    for (const result of [forOrganiser, forCoordinator]) {
      expect(result.status).toBe(403);
      // The refusal must not confirm the event exists, or describe it.
      expect(JSON.stringify(result.body)).not.toContain(target.name);
      expect(JSON.stringify(result.body)).not.toContain("enrolled");
    }
  });

  test("AC3 an event that does not exist is indistinguishable from one the caller does not manage", async () => {
    const unrelated = managesNeither()[0];

    const denied = await api(tokens.coordinator, `/api/managed-events/${unrelated.id}`);
    const missing = await api(tokens.coordinator, `/api/managed-events/${randomUUID()}`);

    expect(denied.status).toBe(missing.status);
    expect(denied.body).toEqual(missing.body);
  });

  test("AC3 a signed-in user with no role on events cannot reach any of it", async () => {
    const own = manages(ids.coordinator)[0];

    const list = await api(tokens.attendee, "/api/managed-events");
    const detail = await api(tokens.attendee, `/api/managed-events/${own.id}`);

    expect(list.status).toBe(403);
    expect(detail.status).toBe(403);
    expect(JSON.stringify(list.body)).not.toContain(own.name);
  });

  test("AC3 no response carries attendee identity or submitted registration data", async () => {
    const target = manages(ids.coordinator)[0];
    const unrelated = managesNeither()[0];

    const responses = await Promise.all([
      api(tokens.coordinator, "/api/managed-events"),
      api(tokens.coordinator, `/api/managed-events/${target.id}`),
      api(tokens.coordinator, `/api/managed-events/${unrelated.id}`),
    ]);

    for (const { body } of responses) {
      const serialised = JSON.stringify(body);
      for (const key of FORBIDDEN_KEYS) {
        expect(body).not.toHaveProperty(key);
        expect(serialised).not.toContain(`"${key}"`);
      }
      // No attendee contact detail of any shape.
      expect(serialised).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });

  afterAll(async () => {
    if (close) await close();
  });
});
