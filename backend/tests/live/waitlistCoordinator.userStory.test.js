import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

const createApp = require("../../src/app");
const { createManagedEventsService } = require("../../src/modules/managedEvents/managedEvents.service");
const { createClient } = require("@supabase/supabase-js");

const live = Boolean(
  process.env.RUN_LIVE_WAITLIST_COORDINATOR_TESTS === "true" &&
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SECRET_KEY &&
  process.env.SUPABASE_PUBLISHABLE_KEY
);

describe.skipIf(!live)("waitlist coordinator controls against live Supabase", () => {
  let admin;
  let authClient;
  let baseUrl;
  let server;
  let organiser;
  let coordinator;
  let attendees = [];
  let eventId;
  let createWaitlistCoordinatorService;

  async function createAccount(roles, fullName) {
    const email = `waitlist-coordinator-${randomUUID()}@example.test`;
    const password = `${randomUUID()}-Aa1!`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { roles },
      user_metadata: { full_name: fullName },
    });
    if (error) throw new Error(`Could not create live coordinator test account: ${error.message}`);
    return { id: data.user.id, email, password };
  }

  async function tokenFor(account) {
    const { data, error } = await authClient.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });
    if (error) throw new Error(`Could not sign in live coordinator test account: ${error.message}`);
    return data.session.access_token;
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

  async function join(token) {
    const response = await api(token, `/api/waitlist/${eventId}`, {
      method: "POST",
      body: JSON.stringify({ registrationData: {} }),
    });
    expect(response.status).toBe(201);
    return response.body.entry;
  }

  beforeAll(async () => {
    createWaitlistCoordinatorService = require("../../src/modules/registrations/waitlistCoordinatorService");
    admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
    authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY);
    organiser = await createAccount(["event_organiser"], "Waitlist Test Organiser");
    coordinator = await createAccount(["event_coordinator"], "Waitlist Test Coordinator");
    attendees = await Promise.all([
      createAccount(["attendee"], "First Queue Member"),
      createAccount(["attendee"], "Manual Override Member"),
    ]);

    eventId = randomUUID();
    const { error } = await admin.from("events").insert({
      id: eventId,
      name: `Waitlist coordinator live test ${eventId}`,
      purpose: "Temporary coordinator waitlist test",
      description: "Disposable live test event",
      status: "APPROVED",
      start_time: "2099-10-10T10:00:00Z",
      end_time: "2099-10-10T12:00:00Z",
      expected_attendance: 1,
      enrolled_attendees: 1,
      organiser_id: organiser.id,
      coordinator_id: coordinator.id,
      registration_fields: [],
    });
    if (error) throw new Error(`Could not create coordinator test event: ${error.message}`);

    const app = createApp({
      authClient,
      dataClient: admin,
      managedEventsService: createManagedEventsService(admin),
      waitlistCoordinatorService: createWaitlistCoordinatorService(admin),
      supabaseUrl: process.env.SUPABASE_URL,
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) {
      server.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.once("close", resolve));
    }
    if (eventId) {
      await admin.from("registrations").delete().eq("event_id", eventId);
      await admin.from("event_waitlist_entries").delete().eq("event_id", eventId);
      await admin.from("events").delete().eq("id", eventId);
    }
    for (const account of [organiser, coordinator, ...attendees].filter(Boolean)) {
      await admin.auth.admin.deleteUser(account.id);
    }
  });

  test("OFF preserves the queue hold; ON reconciles FIFO offers and manual override registration honors existing offers", async () => {
    const coordinatorToken = await tokenFor(coordinator);
    const attendeeTokens = await Promise.all(attendees.map(tokenFor));

    const defaultSetting = await api(
      coordinatorToken,
      `/api/managed-events/${eventId}/waitlist/settings`,
    );
    expect(defaultSetting).toEqual({ status: 200, body: { setting: { enabled: true } } });

    const firstEntry = await join(attendeeTokens[0]);
    const secondEntry = await join(attendeeTokens[1]);
    const disabled = await api(
      coordinatorToken,
      `/api/managed-events/${eventId}/waitlist/settings`,
      { method: "PATCH", body: JSON.stringify({ enabled: false }) },
    );
    expect(disabled).toMatchObject({ status: 200, body: { setting: { enabled: false } } });

    const { error: capacityReleaseError } = await admin
      .from("events")
      .update({ enrolled_attendees: 0 })
      .eq("id", eventId);
    if (capacityReleaseError) throw new Error(`Could not release test seat: ${capacityReleaseError.message}`);

    const stateWhileDisabled = await api(
      attendeeTokens[0],
      `/api/waitlist/${eventId}/state`,
    );
    expect(stateWhileDisabled.status).toBe(200);
    const { data: rowsWhileDisabled, error: rowLookupError } = await admin
      .from("event_waitlist_entries")
      .select("id, offer_state")
      .eq("event_id", eventId)
      .eq("status", "active");
    if (rowLookupError) throw new Error(`Could not inspect disabled queue: ${rowLookupError.message}`);
    expect(rowsWhileDisabled.every((row) => row.offer_state === null)).toBe(true);

    const enabled = await api(
      coordinatorToken,
      `/api/managed-events/${eventId}/waitlist/settings`,
      { method: "PATCH", body: JSON.stringify({ enabled: true }) },
    );
    expect(enabled).toMatchObject({ status: 200, body: { setting: { enabled: true } } });
    const { data: firstOffer, error: offerLookupError } = await admin
      .from("event_waitlist_entries")
      .select("id, attendee_id, offer_state")
      .eq("event_id", eventId)
      .eq("attendee_id", attendees[0].id)
      .eq("status", "active")
      .maybeSingle();
    if (offerLookupError) throw new Error(`Could not inspect reconciled offer: ${offerLookupError.message}`);
    expect(firstOffer).toMatchObject({ id: firstEntry.id, offer_state: "offered" });

    const orderedWaitlist = await api(
      coordinatorToken,
      `/api/managed-events/${eventId}/waitlist?limit=50&offset=0`,
    );
    expect(orderedWaitlist.status).toBe(200);
    const secondRow = orderedWaitlist.body.waitlist.entries.find(
      (entry) => entry.attendeeId === attendees[1].id,
    );
    expect(secondRow).toMatchObject({
      id: secondEntry.id,
      displayName: "Manual Override Member",
      eligible: true,
    });

    const forcedRegistration = await api(
      coordinatorToken,
      `/api/managed-events/${eventId}/waitlist/${secondEntry.id}/promote`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "Approved manual capacity override" }),
      },
    );
    expect(forcedRegistration).toMatchObject({
      status: 200,
      body: { result: { outcome: "registered_over_capacity" } },
    });

    const acceptedOpenOffer = await api(
      attendeeTokens[0],
      `/api/waitlist/${eventId}/offer/accept`,
      { method: "POST", body: "{}" },
    );
    expect(acceptedOpenOffer.status).toBe(200);

    const { data: registrations, error: registrationsError } = await admin
      .from("registrations")
      .select("attendee_id, status")
      .eq("event_id", eventId)
      .order("attendee_id");
    if (registrationsError) throw new Error(`Could not inspect final registrations: ${registrationsError.message}`);
    expect(registrations).toHaveLength(2);
    expect(registrations.every((row) => row.status === "confirmed")).toBe(true);

    const { data: eventAfterPromotions, error: eventLookupError } = await admin
      .from("events")
      .select("expected_attendance, enrolled_attendees")
      .eq("id", eventId)
      .single();
    if (eventLookupError) throw new Error(`Could not inspect final capacity counter: ${eventLookupError.message}`);
    expect(eventAfterPromotions).toEqual({ expected_attendance: 1, enrolled_attendees: 2 });
  });

  test("a request from an organiser is denied even when they own the event", async () => {
    const organiserToken = await tokenFor(organiser);
    const response = await api(
      organiserToken,
      `/api/managed-events/${eventId}/waitlist`,
    );

    expect(response.status).toBe(403);
  });

  test("manual promotion offers the selected queued attendee when a seat is available", async () => {
    const coordinatorToken = await tokenFor(coordinator);
    const attendeeTokens = await Promise.all(attendees.map(tokenFor));

    // Own disposable event so this test never depends on the first test's state.
    const manualEventId = randomUUID();
    const { error: eventError } = await admin.from("events").insert({
      id: manualEventId,
      name: `Waitlist manual-offer live test ${manualEventId}`,
      purpose: "Temporary manual-offer waitlist test",
      description: "Disposable live test event",
      status: "APPROVED",
      start_time: "2099-10-10T10:00:00Z",
      end_time: "2099-10-10T12:00:00Z",
      expected_attendance: 1,
      enrolled_attendees: 1,
      organiser_id: organiser.id,
      coordinator_id: coordinator.id,
      registration_fields: [],
    });
    if (eventError) throw new Error(`Could not create manual-offer test event: ${eventError.message}`);

    try {
      // Pause automatic offers so any offer must come from the manual promotion.
      const paused = await api(
        coordinatorToken,
        `/api/managed-events/${manualEventId}/waitlist/settings`,
        { method: "PATCH", body: JSON.stringify({ enabled: false }) },
      );
      expect(paused).toMatchObject({ status: 200, body: { setting: { enabled: false } } });

      const firstJoin = await api(attendeeTokens[0], `/api/waitlist/${manualEventId}`, {
        method: "POST",
        body: JSON.stringify({ registrationData: {} }),
      });
      const secondJoin = await api(attendeeTokens[1], `/api/waitlist/${manualEventId}`, {
        method: "POST",
        body: JSON.stringify({ registrationData: {} }),
      });
      expect(firstJoin.status).toBe(201);
      expect(secondJoin.status).toBe(201);

      // Free the single seat; automatic offers are off, so nothing is offered yet.
      const { error: releaseError } = await admin
        .from("events")
        .update({ enrolled_attendees: 0 })
        .eq("id", manualEventId);
      if (releaseError) throw new Error(`Could not release manual-offer seat: ${releaseError.message}`);

      const promoted = await api(
        coordinatorToken,
        `/api/managed-events/${manualEventId}/waitlist/${secondJoin.body.entry.id}/promote`,
        { method: "POST", body: JSON.stringify({ reason: "Priority attendee" }) },
      );
      expect(promoted).toMatchObject({
        status: 200,
        body: { result: { outcome: "offered" } },
      });

      const { data: rows, error: rowError } = await admin
        .from("event_waitlist_entries")
        .select("attendee_id, offer_state, offered_at, offer_expires_at")
        .eq("event_id", manualEventId);
      if (rowError) throw new Error(`Could not inspect manual offer: ${rowError.message}`);

      const selectedRow = rows.find((row) => row.attendee_id === attendees[1].id);
      const fifoRow = rows.find((row) => row.attendee_id === attendees[0].id);
      expect(selectedRow.offer_state).toBe("offered");
      expect(Date.parse(selectedRow.offer_expires_at) - Date.parse(selectedRow.offered_at))
        .toBe(3 * 24 * 60 * 60 * 1000);
      expect(fifoRow.offer_state).toBeNull();
    } finally {
      await admin.from("registrations").delete().eq("event_id", manualEventId);
      await admin.from("event_waitlist_entries").delete().eq("event_id", manualEventId);
      await admin.from("events").delete().eq("id", manualEventId);
    }
  });
});
