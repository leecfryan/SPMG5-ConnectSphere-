// SCRUM-26 directory layer: the one file that talks to Supabase Auth.
//
// Everything here is boundary work - paging arithmetic, a role filter over
// data the module does not own, and the field whitelist that keeps an auth
// record from reaching the browser. The service and HTTP suites stub this
// module out entirely, so if these cases do not hold, nothing else notices.
//
// No stubSupabase: the directory takes its client as a constructor argument
// precisely so it can be driven without credentials.

import { test, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createCoordinatorDirectory = require("../../../src/modules/events/coordinators.directory");

const PER_PAGE = 100;
const MAX_PAGES = 20;

function user(id, roles, extra = {}) {
  return {
    id,
    email: `${id}@example.com`,
    app_metadata: { roles },
    user_metadata: { full_name: `Name ${id}` },
    ...extra,
  };
}

// Pages are served from a map so a case states only the pages it cares about;
// anything unasked-for comes back empty and ends the loop.
function clientServing(pages) {
  const listUsers = vi.fn(async ({ page }) => ({ data: { users: pages[page] ?? [] }, error: null }));
  return { client: { auth: { admin: { listUsers } } }, listUsers };
}

function fullPage(prefix) {
  return Array.from({ length: PER_PAGE }, (_, index) => user(`${prefix}-${index}`, ["event_coordinator"]));
}

test("SCRUM-26: only event_coordinator accounts are returned, as id, fullName and email", async () => {
  const { client } = clientServing({ 1: [
    user("coord-1", ["event_coordinator"]),
    user("venue-1", ["venue_staff"]),
    user("tech-1", ["technical_support_staff"]),
    user("manager-1", ["event_ops_manager"]),
  ] });

  const coordinators = await createCoordinatorDirectory(client).listCoordinators();

  expect(coordinators).toEqual([
    { id: "coord-1", fullName: "Name coord-1", email: "coord-1@example.com" },
  ]);
});

test("SCRUM-26: an account holding the role alongside others is still a coordinator", async () => {
  const { client } = clientServing({ 1: [user("both-1", ["venue_staff", "event_coordinator"])] });

  expect(await createCoordinatorDirectory(client).listCoordinators()).toHaveLength(1);
});

// The whitelist is a privacy rule, not a convenience. An auth record carries
// phone numbers, sign-in timestamps, provider identities and the whole of
// app_metadata; a manager picking a name needs none of it.
test("SCRUM-26: no field beyond the three leaves the server", async () => {
  const { client } = clientServing({ 1: [user("coord-1", ["event_coordinator"], {
    phone: "+6591234567",
    last_sign_in_at: "2026-09-01T00:00:00Z",
    identities: [{ provider: "email" }],
    encrypted_password: "should-never-appear",
  })] });

  const [coordinator] = await createCoordinatorDirectory(client).listCoordinators();

  expect(Object.keys(coordinator).sort()).toEqual(["email", "fullName", "id"]);
});

test.each([
  ["app_metadata absent", { app_metadata: undefined }],
  ["app_metadata null", { app_metadata: null }],
  ["roles absent", { app_metadata: {} }],
  ["roles null", { app_metadata: { roles: null } }],
  ["roles a bare string", { app_metadata: { roles: "event_coordinator" } }],
  ["roles an object", { app_metadata: { roles: { event_coordinator: true } } }],
])("SCRUM-26: a malformed %s grants nothing and does not throw", async (_label, shape) => {
  const { client } = clientServing({ 1: [{ id: "odd-1", email: "odd@example.com", ...shape }] });

  expect(await createCoordinatorDirectory(client).listCoordinators()).toEqual([]);
});

// The off-by-one. The loop stops when a page comes back short, so a page of
// exactly PER_PAGE must NOT be treated as the last one.
test("SCRUM-26: a page of exactly the page size is not mistaken for the last page", async () => {
  const { client, listUsers } = clientServing({
    1: fullPage("a"),
    2: [user("coord-last", ["event_coordinator"])],
  });

  const coordinators = await createCoordinatorDirectory(client).listCoordinators();

  expect(coordinators).toHaveLength(PER_PAGE + 1);
  expect(coordinators.some((entry) => entry.id === "coord-last")).toBe(true);
  expect(listUsers).toHaveBeenCalledTimes(2);
});

test("SCRUM-26: a short first page ends the walk without a second request", async () => {
  const { client, listUsers } = clientServing({ 1: [user("coord-1", ["event_coordinator"])] });

  await createCoordinatorDirectory(client).listCoordinators();

  expect(listUsers).toHaveBeenCalledTimes(1);
  expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: PER_PAGE });
});

// A misconfigured page size would otherwise turn one request into an unbounded
// loop against Supabase Auth. The cap is the whole point of MAX_PAGES.
test("SCRUM-26: pages that never run short stop at the cap", async () => {
  const listUsers = vi.fn(async () => ({ data: { users: fullPage("x") }, error: null }));

  const coordinators = await createCoordinatorDirectory({ auth: { admin: { listUsers } } }).listCoordinators();

  expect(listUsers).toHaveBeenCalledTimes(MAX_PAGES);
  expect(coordinators).toHaveLength(MAX_PAGES * PER_PAGE);
});

test("SCRUM-26: no staff at all is an empty list, not a failure", async () => {
  const { client } = clientServing({});

  expect(await createCoordinatorDirectory(client).listCoordinators()).toEqual([]);
});

test.each([
  ["a response with no data", { data: null, error: null }],
  ["a response with no users array", { data: {}, error: null }],
])("SCRUM-26: %s is read as an empty page", async (_label, response) => {
  const listUsers = vi.fn(async () => response);

  expect(await createCoordinatorDirectory({ auth: { admin: { listUsers } } }).listCoordinators()).toEqual([]);
  expect(listUsers).toHaveBeenCalledTimes(1);
});

test("SCRUM-26: a Supabase Auth failure is raised, never returned as an empty directory", async () => {
  const listUsers = vi.fn(async () => ({ data: null, error: { message: "service role key revoked" } }));

  // Swallowing this would show the manager an empty coordinator table and
  // invite them to conclude no coordinators exist.
  await expect(createCoordinatorDirectory({ auth: { admin: { listUsers } } }).listCoordinators())
    .rejects.toThrow("coordinators.directory: listUsers failed - service role key revoked");
});

test("SCRUM-26: coordinators are sorted by the name the row actually displays", async () => {
  const { client } = clientServing({ 1: [
    user("c", ["event_coordinator"], { user_metadata: { full_name: "Cara Ng" } }),
    user("a", ["event_coordinator"], { user_metadata: { full_name: "Ada Tan" } }),
    user("b", ["event_coordinator"], { user_metadata: { full_name: "Ben Lim" } }),
  ] });

  const coordinators = await createCoordinatorDirectory(client).listCoordinators();

  expect(coordinators.map((entry) => entry.fullName)).toEqual(["Ada Tan", "Ben Lim", "Cara Ng"]);
});

// A seeded account may have no full_name at all. The row falls back to the
// email, so the sort has to fall back with it or the nameless rows clump at
// the top under an empty string.
test.each([
  ["missing", undefined],
  ["not a string", 42],
  ["whitespace only", "   "],
])("SCRUM-26: a %s full name becomes empty and sorts on the email instead", async (_label, fullName) => {
  const { client } = clientServing({ 1: [
    user("zeta", ["event_coordinator"], { email: "zeta@example.com", user_metadata: { full_name: fullName } }),
    user("mid", ["event_coordinator"], { email: "mid@example.com", user_metadata: { full_name: "Ada Tan" } }),
  ] });

  const coordinators = await createCoordinatorDirectory(client).listCoordinators();

  expect(coordinators.map((entry) => entry.fullName)).toEqual(["Ada Tan", ""]);
  expect(coordinators.map((entry) => entry.email)).toEqual(["mid@example.com", "zeta@example.com"]);
});

test("SCRUM-26: a full name padded with whitespace is trimmed before display", async () => {
  const { client } = clientServing({ 1: [
    user("coord-1", ["event_coordinator"], { user_metadata: { full_name: "  Ada Tan  " } }),
  ] });

  expect((await createCoordinatorDirectory(client).listCoordinators())[0].fullName).toBe("Ada Tan");
});

test("SCRUM-26: an account with no email is still listed rather than dropped", async () => {
  const { client } = clientServing({ 1: [
    user("coord-1", ["event_coordinator"], { email: undefined, user_metadata: { full_name: "Ada Tan" } }),
  ] });

  expect(await createCoordinatorDirectory(client).listCoordinators()).toEqual([
    { id: "coord-1", fullName: "Ada Tan", email: "" },
  ]);
});
