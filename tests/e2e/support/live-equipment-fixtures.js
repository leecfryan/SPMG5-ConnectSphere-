// Live-Supabase equipment fixtures for tests/e2e (real dev database, no
// fakes/mocks). Mirrors the shape of the retired
// tests/playwright/support/equipment-fixtures.cjs (setupEquipment), but every
// account/event/equipment row created here is real, and every test that uses
// setupEquipment() must call teardown() to delete exactly what it created -
// this is a shared dev database, not a disposable one.
//
// Throwaway accounts (not the coordinator.demo/technical.demo seed accounts)
// are used for anything that needs a *specific* role for a single test, so
// role-mutation tests (e.g. revoking a role mid-test) never touch a shared
// account other developers rely on.
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });
const { randomUUID } = require("node:crypto");
const supabase = require("../../../backend/src/supabase");

async function createAccount(roles, fullName = "Playwright E2E") {
  const email = `pw-e2e-${randomUUID()}@example.test`;
  const password = randomUUID() + "-Aa1!";
  const { data, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { roles },
    user_metadata: { full_name: fullName },
  });
  if (error) throw new Error("createAccount failed: " + error.message);
  return { id: data.user.id, email, password };
}

async function deleteAccount(id) {
  await supabase.auth.admin.deleteUser(id);
}

async function updateAccountRoles(id, roles) {
  const { error } = await supabase.auth.admin.updateUserById(id, { app_metadata: { roles } });
  if (error) throw new Error("updateAccountRoles failed: " + error.message);
}

// For API-level tests (raw HTTP via Playwright's `request` fixture, not a
// browser session) - a real access token from Supabase's real Auth REST API,
// same call the frontend's own sign-in makes.
async function getAccessToken(account) {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!response.ok) throw new Error("getAccessToken failed: " + (await response.text()));
  return (await response.json()).access_token;
}

// status defaults to APPROVED (not DRAFT) so listAssignedEvents (used by the
// coordinator's "Assigned event" dropdown) includes it.
async function createEvent({ organiserId, coordinatorId, name, status = "APPROVED", startTime = "2099-10-10T00:00:00Z", endTime = "2099-10-10T15:00:00Z" }) {
  const id = randomUUID();
  const { error } = await supabase.from("events").insert({
    id, name: name || "E2E equipment test " + id.slice(0, 8),
    purpose: "Playwright live-DB e2e fixture",
    description: "Created by an automated test - safe to delete.",
    start_time: startTime, end_time: endTime, expected_attendance: 10,
    status, organiser_id: organiserId, coordinator_id: coordinatorId,
  });
  if (error) throw new Error("createEvent failed: " + error.message);
  return id;
}

// equipment_requests.event_id (and messages via equipment_request_id) cascade
// on delete, so deleting the event is enough to clean those up too.
async function deleteEvent(id) {
  await supabase.from("events").delete().eq("id", id);
}

async function updateEvent(id, fields) {
  const { error } = await supabase.from("events").update(fields).eq("id", id);
  if (error) throw new Error("updateEvent failed: " + error.message);
}

async function createEquipmentUnit({ type, status = "AVAILABLE", location = "E2E Test Room" }) {
  const id = randomUUID();
  const { error } = await supabase.from("equipment").insert({ id, type, current_location: location, status });
  if (error) throw new Error("createEquipmentUnit failed: " + error.message);
  return id;
}

async function deleteEquipmentUnit(id) {
  await supabase.from("equipment").delete().eq("id", id);
}

function freshType() {
  return "SCRUM29_E2E_" + randomUUID().slice(0, 8);
}

// One organiser, one assigned coordinator, one technical support account, one
// unrelated ("outsider") coordinator, one event assigned to the coordinator,
// and one bookable equipment unit - the common shape every equipment e2e test
// in this file needs. Call teardown() in the test's cleanup.
async function setupEquipment() {
  const [organiser, coordinator, technical, outsider] = await Promise.all([
    createAccount(["event_organiser"]),
    createAccount(["event_coordinator"]),
    createAccount(["technical_support_staff"]),
    createAccount(["event_coordinator"]),
  ]);
  const eventId = await createEvent({ organiserId: organiser.id, coordinatorId: coordinator.id });
  const equipmentType = freshType();
  const equipmentId = await createEquipmentUnit({ type: equipmentType });

  async function teardown() {
    await deleteEvent(eventId);
    await deleteEquipmentUnit(equipmentId);
    await Promise.all([organiser, coordinator, technical, outsider].map((a) => deleteAccount(a.id)));
  }

  return { organiser, coordinator, technical, outsider, eventId, equipmentType, equipmentId, teardown };
}

module.exports = {
  createAccount, deleteAccount, updateAccountRoles, getAccessToken,
  createEvent, deleteEvent, updateEvent,
  createEquipmentUnit, deleteEquipmentUnit,
  freshType, setupEquipment,
};
