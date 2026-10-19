// /api/events/drafts over real HTTP: router → permission → controller →
// service → validation. Only the repository is faked, so this proves who may
// reach a draft and the status codes and bodies the frontend depends on.

import { test, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createRequire } from "node:module";

// The modules under test are CommonJS; see events.submit.test.js for why they
// are loaded with createRequire.
const require = createRequire(import.meta.url);
const createApp = require("../../src/app");
const { stubSupabase } = require("../helpers/stubSupabase");

stubSupabase();
const repository = require("../../src/modules/events/events.repository");

const ORGANISER_ID = "verified-organiser-id";
const COLLEAGUE_ID = "colleague-organiser-id";
const DRAFT_ID = "11111111-1111-4111-8111-111111111111";

// The token names the caller: "<role>" is the organiser, "colleague" another
// organiser from the same company.
const app = createApp({
  authClient: { auth: { getUser: async (token) => ({
    data: { user: token === "invalid" ? null : {
      id: token === "colleague" ? COLLEAGUE_ID : ORGANISER_ID,
      app_metadata: { roles: [token === "colleague" ? "event_organiser" : token] },
    } }, error: null,
  }) } },
  eventsRepository: repository,
  supabaseUrl: "https://example.supabase.co", publishableKey: "test-public-key",
});

let server;
let baseUrl;
beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

let stored;
let spies;
beforeEach(() => {
  vi.restoreAllMocks();
  stored = { id: DRAFT_ID, organiser_id: ORGANISER_ID, status: "DRAFT", name: "Gala" };
  const own = (id, organiserId) => (id === stored.id && organiserId === stored.organiser_id && stored.status === "DRAFT" ? stored : null);
  spies = {
    createDraft: vi.spyOn(repository, "createDraft").mockImplementation(async (fields, organiserId) =>
      ({ id: DRAFT_ID, status: "DRAFT", organiser_id: organiserId, ...fields })),
    findOwnDrafts: vi.spyOn(repository, "findOwnDrafts").mockImplementation(async (organiserId) =>
      (organiserId === stored.organiser_id ? [stored] : [])),
    findOwnDraft: vi.spyOn(repository, "findOwnDraft").mockImplementation(async (id, organiserId) => own(id, organiserId)),
    updateDraft: vi.spyOn(repository, "updateDraft").mockImplementation(async (id, organiserId, fields) =>
      own(id, organiserId) && Object.assign(stored, fields)),
    markSubmitted: vi.spyOn(repository, "markSubmitted").mockImplementation(async (id, organiserId, fields) =>
      own(id, organiserId) && Object.assign(stored, fields, { status: "SUBMITTED" })),
  };
});

function completeDetails() {
  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return {
    purpose: "Reconnect alumni",
    description: "Dinner, awards and networking.",
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    expected_attendance: "200",
  };
}

async function call(method, path, { body, token = "event_organiser" } = {}) {
  const response = await fetch(`${baseUrl}/api/events/drafts${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const ROUTES = [
  ["POST", "", { name: "Gala" }],
  ["GET", ""],
  ["GET", `/${DRAFT_ID}`],
  ["PATCH", `/${DRAFT_ID}`, { name: "Gala" }],
  ["POST", `/${DRAFT_ID}/submit`, {}],
];
const DENIED = [
  ["", 401], ["invalid", 401], ["attendee", 403], ["venue_staff", 403], ["technical_support_staff", 403],
  ["event_coordinator", 403], ["event_coordinator_lead", 403], ["safety_officer", 403],
];

test.each(ROUTES.flatMap(([method, path, body]) => DENIED.map(([token, expected]) => [method, path, token, expected, body])))(
  "[SCRUM-147-API-001] AC4: %s drafts%s refuses token '%s' with HTTP %s and touches no draft",
  async (method, path, token, expected, body) => {
    const response = await call(method, path, { body, token });
    expect(response.status).toBe(expected);
    expect(response.body.event).toBeUndefined();
    expect(response.body.drafts).toBeUndefined();
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  },
);

test("[SCRUM-147-API-002] AC1: 201 - a name alone saves a DRAFT owned by the verified caller", async () => {
  const { status, body } = await call("POST", "", {
    body: { name: "Gala", organiser_id: COLLEAGUE_ID, status: "SUBMITTED", coordinator_id: "self" },
  });

  expect(status).toBe(201);
  expect(body.event).toMatchObject({ status: "DRAFT", organiser_id: ORGANISER_ID, name: "Gala" });
  expect(spies.createDraft).toHaveBeenCalledExactlyOnceWith({ name: "Gala" }, ORGANISER_ID);
});

test("[SCRUM-147-API-003] AC1: 400 - a draft without a name is refused with the field named", async () => {
  const { status, body } = await call("POST", "", { body: { purpose: "Reconnect alumni" } });

  expect(status).toBe(400);
  expect(body.errors.map((e) => e.field)).toEqual(["name"]);
  expect(spies.createDraft).not.toHaveBeenCalled();
});

test("[SCRUM-147-API-004] AC3/AC4: the list holds only the caller's drafts", async () => {
  expect(await call("GET", "")).toEqual({ status: 200, body: { drafts: [stored] } });
  expect(await call("GET", "", { token: "colleague" })).toEqual({ status: 200, body: { drafts: [] } });
  expect(spies.findOwnDrafts.mock.calls).toEqual([[ORGANISER_ID], [COLLEAGUE_ID]]);
});

test("[SCRUM-147-API-005] AC3: the owner opens their draft", async () => {
  expect(await call("GET", `/${DRAFT_ID}`)).toEqual({ status: 200, body: { event: stored } });
});

test("[SCRUM-147-API-006] AC4: a colleague gets 404 for read, edit and submit, and the draft is unchanged", async () => {
  for (const [method, path, body] of ROUTES.slice(2)) {
    const response = await call(method, path, { body: body && { ...body, ...completeDetails() }, token: "colleague" });
    expect(response).toEqual({ status: 404, body: { message: "Draft not found." } });
  }
  expect(stored).toEqual({ id: DRAFT_ID, organiser_id: ORGANISER_ID, status: "DRAFT", name: "Gala" });
});

test("[SCRUM-147-API-007] 400 - a malformed draft id is refused before any lookup", async () => {
  for (const [method, path, body] of [["GET", "/not-a-uuid"], ["PATCH", "/not-a-uuid", { name: "Gala" }], ["POST", "/not-a-uuid/submit", {}]]) {
    expect(await call(method, path, { body })).toEqual({ status: 400, body: { message: "Invalid draft id." } });
  }
  expect(spies.findOwnDraft).not.toHaveBeenCalled();
});

test("[SCRUM-147-API-008] AC3: 200 - an edit is saved and the draft stays a draft", async () => {
  const { status, body } = await call("PATCH", `/${DRAFT_ID}`, { body: { purpose: "Reconnect alumni", start_time: "" } });

  expect(status).toBe(200);
  expect(body.event).toMatchObject({ status: "DRAFT", purpose: "Reconnect alumni", start_time: null });
});

test("[SCRUM-147-API-009] AC2: 400 - submitting an incomplete draft lists every missing field and keeps it a draft", async () => {
  const { status, body } = await call("POST", `/${DRAFT_ID}/submit`, { body: {} });

  expect(status).toBe(400);
  expect(body.errors.map((e) => e.field).sort()).toEqual(["description", "end_time", "expected_attendance", "purpose", "start_time"]);
  expect(stored.status).toBe("DRAFT");
  expect(spies.markSubmitted).not.toHaveBeenCalled();
});

test("[SCRUM-147-API-010] AC3: 200 - a completed draft is submitted with its latest edits", async () => {
  const { status, body } = await call("POST", `/${DRAFT_ID}/submit`, { body: completeDetails() });

  expect(status).toBe(200);
  expect(body.event).toMatchObject({ status: "SUBMITTED", name: "Gala", expected_attendance: 200, organiser_id: ORGANISER_ID });
});

test("[SCRUM-147-API-011] conflict: 409 - a draft submitted elsewhere cannot be edited, and is then not found", async () => {
  spies.updateDraft.mockResolvedValueOnce(null);
  expect((await call("PATCH", `/${DRAFT_ID}`, { body: { name: "Gala 2" } })).status).toBe(409);

  await call("POST", `/${DRAFT_ID}/submit`, { body: completeDetails() });
  expect((await call("PATCH", `/${DRAFT_ID}`, { body: { name: "Gala 3" } })).status).toBe(404);
  expect((await call("POST", `/${DRAFT_ID}/submit`, { body: completeDetails() })).status).toBe(404);
});

test("[SCRUM-147-API-012] failure: 500 - a database failure returns a safe message, not the Supabase error", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  spies.createDraft.mockRejectedValueOnce(new Error("events.repository: createDraft failed - secret detail"));
  spies.findOwnDrafts.mockRejectedValueOnce(new Error("events.repository: findOwnDrafts failed - secret detail"));

  for (const [method, body] of [["POST", { name: "Gala" }], ["GET"]]) {
    const response = await call(method, "", { body });
    expect(response).toEqual({ status: 500, body: { message: "Could not save the draft. Please try again." } });
  }
});

test("[SCRUM-147-API-013] failure: 503 - drafts fail closed when event storage is not configured", async () => {
  const unconfigured = createApp({
    authClient: { auth: { getUser: async () => ({ data: { user: { id: ORGANISER_ID, app_metadata: { roles: ["event_organiser"] } } }, error: null }) } },
    supabaseUrl: "https://example.supabase.co", publishableKey: "test-public-key",
  });
  const listener = unconfigured.listen(0, "127.0.0.1");
  await new Promise((resolve) => listener.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${listener.address().port}/api/events/drafts`, { headers: { Authorization: "Bearer organiser" } });
    expect(response.status).toBe(503);
  } finally {
    await new Promise((resolve) => { listener.close(resolve); listener.closeAllConnections(); });
  }
});
