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
  process.env.RUN_LIVE_WAITLIST_OFFER_TESTS === "true" &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SECRET_KEY &&
  process.env.SUPABASE_PUBLISHABLE_KEY
);

const REQUIRED_FIELDS = [
  { id: "dietary", label: "Dietary requirements", required: true },
];

describe.skipIf(!live)("Waitlist offer story against real Supabase", () => {
  let admin;
  let authClient;
  let baseUrl;
  let server;
  let organiser;
  let coordinator;
  let attendees;
  let tokens;
  let eventId;

  async function createAccount(roles) {
    const email = `waitlist-offer-${randomUUID()}@example.test`;
    const password = `${randomUUID()}-Aa1!`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { roles },
    });
    if (error) throw new Error(`Could not create live offer test account: ${error.message}`);
    return { id: data.user.id, email, password };
  }

  async function signIn(account) {
    const { data, error } = await authClient.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });
    if (error) throw new Error(`Could not sign in live offer test account: ${error.message}`);
    return data.session.access_token;
  }

  async function createTemporaryEvent({
    capacity = 1,
    enrolled = capacity,
    status = "APPROVED",
    startTime = "2099-10-10T10:00:00Z",
    registrationStart = null,
    registrationEnd = null,
    registrationFields = [],
  } = {}) {
    eventId = randomUUID();
    const { error } = await admin.from("events").insert({
      id: eventId,
      name: `Waitlist offer live test ${eventId}`,
      purpose: "Temporary live waitlist offer test",
      description: "Disposable event created by waitlistOffers.userStory.test.js",
      status,
      start_time: startTime,
      end_time: "2099-10-10T12:00:00Z",
      expected_attendance: capacity,
      enrolled_attendees: enrolled,
      registration_fields: registrationFields,
      registration_start: registrationStart,
      registration_end: registrationEnd,
      organiser_id: organiser.id,
      coordinator_id: coordinator.id,
    });
    if (error) throw new Error(`Could not create temporary offer event: ${error.message}`);
  }

  async function updateEvent(fields) {
    const { error } = await admin.from("events").update(fields).eq("id", eventId);
    if (error) throw new Error(`Could not update temporary offer event: ${error.message}`);
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

  async function join(index, data = null) {
    return api(tokens.attendees[index], `/api/waitlist/${eventId}`, {
      method: "POST",
      body: JSON.stringify({ registrationData: data }),
    });
  }

  async function getState(index = 0) {
    return api(tokens.attendees[index], `/api/waitlist/${eventId}`);
  }

  async function reconcile() {
    const { data, error } = await admin.rpc("reconcile_event_waitlist", {
      p_event_id: eventId,
    });
    if (error) throw new Error(`Could not reconcile temporary waitlist: ${error.message}`);
    return data;
  }

  async function sweepEvent() {
    const { data, error } = await admin.rpc("reconcile_waitlist_offers", {
      p_batch_size: 100,
      p_event_id: eventId,
    });
    if (error) throw new Error(`Could not sweep temporary waitlist event: ${error.message}`);
    return data;
  }

  async function readEntries() {
    const { data, error } = await admin
      .from("event_waitlist_entries")
      .select("id, event_id, attendee_id, status, offer_state, created_at, offered_at, offer_expires_at, registration_data, override_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw new Error(`Could not read temporary waitlist: ${error.message}`);
    return data;
  }

  async function seedEntry(index, {
    registrationData = null,
    createdAt,
    overrideAt = null,
  } = {}) {
    const row = {
      event_id: eventId,
      attendee_id: attendees[index].id,
      status: "active",
      registration_data: registrationData,
      override_at: overrideAt,
    };
    if (createdAt) row.created_at = createdAt;
    const { data, error } = await admin
      .from("event_waitlist_entries")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(`Could not seed live waitlist entry: ${error.message}`);
    return data;
  }

  async function seedRegistration(index, status, data = null) {
    const { error } = await admin.from("registrations").insert({
      event_id: eventId,
      attendee_id: attendees[index].id,
      status,
      registration_data: data,
    });
    if (error) throw new Error(`Could not seed live registration: ${error.message}`);
  }

  async function setOfferAge(index, ageMs, serverTime) {
    const offeredAt = new Date(Date.parse(serverTime) - ageMs);
    const expiresAt = new Date(offeredAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    const { error } = await admin
      .from("event_waitlist_entries")
      .update({
        offer_state: "offered",
        offered_at: offeredAt.toISOString(),
        offer_expires_at: expiresAt.toISOString(),
      })
      .eq("event_id", eventId)
      .eq("attendee_id", attendees[index].id);
    if (error) throw new Error(`Could not set controlled offer dates: ${error.message}`);
  }

  async function readRegistration(index) {
    const { data, error } = await admin
      .from("registrations")
      .select("id, status, registration_data, updated_at")
      .eq("event_id", eventId)
      .eq("attendee_id", attendees[index].id)
      .maybeSingle();
    if (error) throw new Error(`Could not read registration: ${error.message}`);
    return data;
  }

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
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    [organiser, coordinator, ...attendees] = await Promise.all([
      createAccount(["event_organiser"]),
      createAccount(["event_coordinator"]),
      createAccount(["attendee"]),
      createAccount(["attendee"]),
      createAccount(["attendee"]),
      createAccount(["attendee"]),
    ]);
    tokens = {
      coordinator: await signIn(coordinator),
      attendees: await Promise.all(attendees.map(signIn)),
    };
  }, 60_000);

  beforeEach(async () => {
    await createTemporaryEvent();
  });

  afterEach(async () => {
    if (!eventId) return;
    const currentEventId = eventId;
    const waitlistResult = await admin
      .from("event_waitlist_entries")
      .delete()
      .eq("event_id", currentEventId);
    const registrationsResult = await admin
      .from("registrations")
      .delete()
      .eq("event_id", currentEventId);
    const eventResult = await admin.from("events").delete().eq("id", currentEventId);
    const errors = [
      waitlistResult.error && `waitlist: ${waitlistResult.error.message}`,
      registrationsResult.error && `registrations: ${registrationsResult.error.message}`,
      eventResult.error && `event: ${eventResult.error.message}`,
    ].filter(Boolean);
    eventId = undefined;
    if (errors.length) throw new Error(`Could not clean live offer fixture: ${errors.join("; ")}`);
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    }
    for (const account of [attendees?.[3], attendees?.[2], attendees?.[1], attendees?.[0], coordinator, organiser].filter(Boolean)) {
      const { error } = await admin.auth.admin.deleteUser(account.id);
      if (error) throw new Error(`Could not delete live offer test account: ${error.message}`);
    }
  });

  test("AC1: a released seat offers FIFO entries with a database-timed three-day deadline", async () => {
    await join(0, { dietary: "Vegetarian" });
    await join(1, { dietary: "None" });
    await updateEvent({ enrolled_attendees: 0 });
    const state = await getState(0);

    expect(state.status).toBe(200);
    expect(state.body.entry.status).toBe("active");
    expect(state.body.entry.offer_state).toBe("offered");
    expect(state.body.entry).not.toHaveProperty("offer_expires_at");
    const entry = (await readEntries()).find((row) => row.attendee_id === attendees[0].id);
    expect(entry.status).toBe("active");
    expect(entry.offer_state).toBe("offered");
    expect(Date.parse(entry.offer_expires_at) - Date.parse(entry.offered_at)).toBe(3 * 24 * 60 * 60 * 1000);
    expect(Date.parse(state.body.effective_deadline)).toBe(Date.parse(entry.offer_expires_at));
    expect(state.body.server_time).toBeTruthy();
    expect((await readEntries()).find((row) => row.attendee_id === attendees[1].id).status).toBe("active");
  });

  test("AC2: accepting within 2d23h confirms once and transfers the held seat", async () => {
    await join(0, { dietary: "Vegetarian" });
    await updateEvent({ enrolled_attendees: 0 });
    const state = await getState(0);
    await setOfferAge(0, 2 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000, state.body.server_time);

    const result = await api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/accept`, {
      method: "POST",
    });
    expect(result.status).toBe(200);
    expect((await readRegistration(0)).status).toBe("confirmed");
    expect((await readEntries()).some((row) => row.attendee_id === attendees[0].id)).toBe(false);
    const { data: event } = await admin.from("events").select("enrolled_attendees").eq("id", eventId).single();
    expect(event.enrolled_attendees).toBe(1);
  });

  test("AC2: accepting at 3d0h1m is rejected and passes the seat on", async () => {
    await join(0);
    await join(1);
    await updateEvent({ enrolled_attendees: 0 });
    const firstState = await getState(0);
    const firstEntry = (await readEntries()).find((row) => row.attendee_id === attendees[0].id);
    await setOfferAge(0, 3 * 24 * 60 * 60 * 1000 + 60 * 1000, firstState.body.server_time);

    const result = await api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/accept`, {
      method: "POST",
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("expired");
    const next = await getState(1);
    expect(next.body.entry.offer_state).toBe("offered");
    expect(Date.parse(next.body.entry.offered_at)).toBeGreaterThan(Date.parse(
      firstEntry.offered_at
    ));
  });

  test.each(["decline", "expiry"])("AC3: %s releases the hold and offers the next attendee fresh", async (transition) => {
    await join(0);
    await join(1);
    await updateEvent({ enrolled_attendees: 0 });
    const firstState = await getState(0);

    if (transition === "decline") {
      const declined = await api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/decline`, {
        method: "POST",
      });
      expect(declined.status).toBe(204);
    } else {
      await setOfferAge(0, 3 * 24 * 60 * 60 * 1000 + 60 * 1000, firstState.body.server_time);
      await reconcile();
    }

    const next = await getState(1);
    expect(next.body.entry.offer_state).toBe("offered");
    const nextEntry = (await readEntries()).find((row) => row.attendee_id === attendees[1].id);
    expect(Date.parse(nextEntry.offer_expires_at) - Date.parse(nextEntry.offered_at))
      .toBe(3 * 24 * 60 * 60 * 1000);
  });

  test("AC3: positions are one-based and update after an earlier attendee withdraws", async () => {
    await join(0);
    await join(1);
    await join(2);
    expect((await getState(0)).body.position).toBe(1);
    expect((await getState(1)).body.position).toBe(2);
    expect((await getState(2)).body.position).toBe(3);

    const withdrawn = await api(tokens.attendees[0], `/api/waitlist/${eventId}`, {
      method: "DELETE",
    });
    expect(withdrawn.status).toBe(204);
    expect((await getState(1)).body.position).toBe(1);
    expect((await getState(2)).body.position).toBe(2);
  });

  test("a declined attendee may rejoin at the back of the active queue", async () => {
    await join(0);
    await join(1);
    await updateEvent({ enrolled_attendees: 0 });
    await getState(0);

    const declined = await api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/decline`, {
      method: "POST",
    });
    expect(declined.status).toBe(204);
    const rejoined = await join(0);
    expect(rejoined.status).toBe(201);
    expect(rejoined.body.position).toBe(2);
  });

  test("ordering: overrides sort before FIFO and positions use that same order", async () => {
    await updateEvent({ expected_attendance: 3, enrolled_attendees: 3 });
    await seedEntry(0, { createdAt: "2026-01-01T00:00:00Z" });
    await seedEntry(1, { createdAt: "2026-01-02T00:00:00Z" });
    await seedEntry(2, { createdAt: "2026-01-03T00:00:00Z", overrideAt: "2026-05-01T00:00:00Z" });
    await updateEvent({ enrolled_attendees: 0 });
    await reconcile();

    expect((await readEntries()).find((row) => row.attendee_id === attendees[2].id).offer_state).toBe("offered");
    const state = await getState(0);
    expect(state.body.position).toBe(2);
    const positionOrder = [];
    for (const index of [0, 1, 2]) {
      const attendeeState = await getState(index);
      positionOrder.push([index, attendeeState.body.position]);
    }
    expect(positionOrder.sort((a, b) => a[1] - b[1]).map(([index]) => index)).toEqual([2, 0, 1]);
  });

  test("release: multiple free seats offer multiple FIFO attendees; an empty queue leaves capacity free", async () => {
    await updateEvent({ expected_attendance: 3, enrolled_attendees: 3 });
    await join(0);
    await join(1);
    await join(2);
    await updateEvent({ enrolled_attendees: 0 });
    await reconcile();
    expect((await readEntries()).filter((row) => row.offer_state === "offered")).toHaveLength(3);

    const { error: clearError } = await admin
      .from("event_waitlist_entries")
      .delete()
      .eq("event_id", eventId);
    if (clearError) throw new Error(`Could not clear temporary waitlist: ${clearError.message}`);
    const before = await readEntries();
    expect(before).toHaveLength(0);
    expect((await reconcile()).outcome).toBe("reconciled");
    expect(await readEntries()).toHaveLength(0);
  });

  test("window dates do not block waitlist join, offer, or accept; normal registration still checks them", async () => {
    await updateEvent({
      registration_start: "2099-01-01T00:00:00Z",
      registration_end: "2000-01-01T00:00:00Z",
    });
    expect((await join(0)).status).toBe(201);
    await updateEvent({ enrolled_attendees: 0 });
    await getState(0);

    const accepted = await api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/accept`, {
      method: "POST",
    });
    expect(accepted.status).toBe(200);
    const normal = await api(tokens.attendees[1], "/api/registrations", {
      method: "POST",
      body: JSON.stringify({ eventId }),
    });
    expect(normal.status).toBe(409);
  });

  test("effective deadline follows an earlier start-time edit; a past start revokes offers", async () => {
    await join(0);
    await updateEvent({ enrolled_attendees: 0 });
    await getState(0);
    const editedStart = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await updateEvent({ start_time: editedStart });
    const state = await getState(0);
    expect(Date.parse(state.body.effective_deadline)).toBe(Date.parse(editedStart));

    await updateEvent({ start_time: new Date(Date.now() - 60_000).toISOString() });
    const revoked = await getState(0);
    expect(revoked.status).toBe(200);
    expect(revoked.body.entry).toBeNull();
    expect(await readEntries()).toHaveLength(0);
  });

  test("a queue with less than one hour until start remains active but receives no offer", async () => {
    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await updateEvent({ start_time: soon });
    await join(0);
    await updateEvent({ enrolled_attendees: 0 });

    const state = await getState(0);
    expect(state.status).toBe(200);
    expect(state.body.entry.status).toBe("active");
    expect(state.body.effective_deadline).toBeNull();
    expect((await readEntries())[0].status).toBe("active");
  });

  test("accept after start is rejected and revokes the open offer", async () => {
    await join(0);
    await updateEvent({ enrolled_attendees: 0 });
    await getState(0);
    await updateEvent({ start_time: new Date(Date.now() - 60_000).toISOString() });

    const result = await api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/accept`, {
      method: "POST",
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("event_ineligible");
    expect(await readEntries()).toHaveLength(0);
  });

  test.each([
    ["unapproved", { status: "DRAFT" }],
    ["cancelled", { cancelled_at: "2026-01-01T00:00:00Z" }],
  ])("an offer is revoked when an event becomes %s", async (_label, fields) => {
    await join(0);
    await updateEvent({ enrolled_attendees: 0 });
    await getState(0);
    await updateEvent(fields);

    const state = await getState(0);
    expect(state.status).toBe(200);
    expect(state.body.entry).toBeNull();
    expect(await readEntries()).toHaveLength(0);
  });

  test("a capacity increase is swept; a decrease preserves offers and creates none", async () => {
    await updateEvent({ expected_attendance: 2, enrolled_attendees: 2 });
    await join(0);
    await join(1);
    await updateEvent({ expected_attendance: 3, enrolled_attendees: 2 });
    const increased = await sweepEvent();
    expect(increased.processed_events).toBe(1);
    expect((await readEntries()).filter((row) => row.offer_state === "offered")).toHaveLength(1);

    await seedRegistration(2, "confirmed");
    await updateEvent({ enrolled_attendees: 3, expected_attendance: 2 });
    const decreased = await sweepEvent();
    expect(decreased.processed_events).toBe(0);
    const entries = await readEntries();
    expect(entries.filter((row) => row.offer_state === "offered")).toHaveLength(1);
    expect(entries.filter((row) => row.status === "active")).toHaveLength(2);
    expect((await readRegistration(2)).status).toBe("confirmed");
  });

  test("a sweep with nothing eligible performs no writes", async () => {
    await join(0);
    const before = await readEntries();
    const result = await sweepEvent();
    expect(result.processed_events).toBe(0);
    expect(await readEntries()).toEqual(before);
  });

  test("pending/confirmed registrations are removed; withdrawn registration is reactivated", async () => {
    for (const status of ["pending", "confirmed"]) {
      await seedEntry(0, { registrationData: { dietary: "None" } });
      await seedRegistration(0, status);
      await updateEvent({ enrolled_attendees: 0 });
      const result = await api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/accept`, { method: "POST" });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("already_registered");
      expect((await readEntries()).length).toBe(0);
      await admin.from("registrations").delete().eq("event_id", eventId);
    }

    await seedEntry(0, { registrationData: { dietary: "Vegan" } });
    await seedRegistration(0, "withdrawn", { dietary: "Old value" });
    await updateEvent({ enrolled_attendees: 0 });
    await reconcile();
    const accepted = await api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/accept`, { method: "POST" });
    expect(accepted.status).toBe(200);
    expect(await readRegistration(0)).toMatchObject({
      status: "confirmed",
      registration_data: { dietary: "Vegan" },
    });
  });

  test("legacy offered entry requires details and updates without changing its deadline or queue time", async () => {
    await updateEvent({ registration_fields: REQUIRED_FIELDS });
    const seeded = await seedEntry(0);
    await updateEvent({ enrolled_attendees: 0 });
    await reconcile();
    const before = (await readEntries()).find((row) => row.id === seeded.id);

    const blocked = await api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/accept`, { method: "POST" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("details_required");

    const updated = await api(tokens.attendees[0], `/api/waitlist/${eventId}/details`, {
      method: "PUT",
      body: JSON.stringify({ registrationData: { dietary: "No restrictions" } }),
    });
    expect(updated.status).toBe(200);
    const after = (await readEntries()).find((row) => row.id === seeded.id);
    expect(after.created_at).toBe(before.created_at);
    expect(after.offer_expires_at).toBe(before.offer_expires_at);
    expect(after.registration_data).toEqual({ dietary: "No restrictions" });
  });

  test("race: only one concurrent acceptance confirms the attendee", async () => {
    await join(0);
    await updateEvent({ enrolled_attendees: 0 });
    await getState(0);
    const results = await Promise.all([
      api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/accept`, { method: "POST" }),
      api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/accept`, { method: "POST" }),
    ]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => [404, 409].includes(result.status))).toHaveLength(1);
    expect((await readRegistration(0)).status).toBe("confirmed");
  });

  test("race: accept and expiry serialize without duplicate registration or retained offer", async () => {
    await join(0);
    await join(1);
    await updateEvent({ enrolled_attendees: 0 });
    const firstState = await getState(0);
    await setOfferAge(0, 3 * 24 * 60 * 60 * 1000 + 60 * 1000, firstState.body.server_time);

    const [accepted, expired] = await Promise.all([
      api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/accept`, { method: "POST" }),
      admin.rpc("expire_waitlist_offers", { p_event_id: eventId }),
    ]);
    if (expired.error) throw new Error(`Could not expire test offer: ${expired.error.message}`);
    expect([404, 409]).toContain(accepted.status);
    expect(await readRegistration(0)).toBeNull();
    expect((await getState(1)).body.entry.offer_state).toBe("offered");
  });

  test("race: decline and a second seat release preserve FIFO and pass both offers", async () => {
    await updateEvent({ expected_attendance: 3, enrolled_attendees: 3 });
    await join(0);
    await join(1);
    await join(2);
    await updateEvent({ enrolled_attendees: 2 });
    await getState(0);

    const [declined, releaseError] = await Promise.all([
      api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/decline`, { method: "POST" }),
      updateEvent({ enrolled_attendees: 1 }),
    ]);
    expect(declined.status).toBe(204);
    expect(releaseError).toBeUndefined();
    await getState(1);
    const remaining = await readEntries();
    expect(remaining.some((row) => row.attendee_id === attendees[0].id)).toBe(false);
    expect(remaining.filter((row) => row.offer_state === "offered")).toHaveLength(2);
  });

  test("race: event start edit and acceptance serialize; no stale offer survives", async () => {
    await join(0);
    await updateEvent({ enrolled_attendees: 0 });
    await getState(0);

    const [editResult, acceptance] = await Promise.all([
      updateEvent({ start_time: new Date(Date.now() - 60_000).toISOString() }),
      api(tokens.attendees[0], `/api/waitlist/${eventId}/offer/accept`, { method: "POST" }),
    ]);
    expect(editResult).toBeUndefined();
    expect([200, 409]).toContain(acceptance.status);
    expect(await readEntries()).toHaveLength(0);
    const registration = await readRegistration(0);
    expect(registration === null || registration.status === "confirmed").toBe(true);
  });

  test("race: a released seat is offered before a normal registration can claim it", async () => {
    await join(0);
    await updateEvent({ enrolled_attendees: 0 });
    const [state, registration] = await Promise.all([
      getState(0),
      api(tokens.attendees[1], "/api/registrations", {
        method: "POST",
        body: JSON.stringify({ eventId }),
      }),
    ]);
    expect(state.body.entry.offer_state).toBe("offered");
    expect(registration.status).toBe(409);
  });

  test("auth: only the offered attendee accepts or declines; wrong role and anonymous are denied", async () => {
    await join(0);
    await updateEvent({ enrolled_attendees: 0 });
    await getState(0);

    expect((await api(null, `/api/waitlist/${eventId}/offer/accept`, { method: "POST" })).status).toBe(401);
    expect((await api(tokens.coordinator, `/api/waitlist/${eventId}/offer/accept`, { method: "POST" })).status).toBe(403);
    expect((await api(tokens.attendees[1], `/api/waitlist/${eventId}/offer/accept`, { method: "POST" })).status).toBe(404);
    expect((await api(tokens.attendees[1], `/api/waitlist/${eventId}/offer/decline`, { method: "POST" })).status).toBe(404);
  });
});
