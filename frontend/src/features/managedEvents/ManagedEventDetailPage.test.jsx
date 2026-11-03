// @vitest-environment jsdom
// Only Auth and network transport are faked; the route tree, permission guard
// and both pages are the real ones. The REAL permission policy decides what the
// session may reach, so removing either permission fails this file.
import { createRequire } from "node:module";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import App from "../../App";
import { getAuthClient } from "../../lib/supabase";

const require = createRequire(import.meta.url);
const { getPermissions } = require("../../../../backend/src/auth/permissions.js");

vi.mock("../../lib/supabase", () => ({ getAuthClient: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

const EVENT_ID = "aaaaaaaa-0001-0000-0000-000000000000";
const OTHER_EVENT_ID = "aaaaaaaa-0003-0000-0000-000000000000";

const SUMMARY = {
  id: EVENT_ID,
  name: "Annual Alumni Gala",
  start_time: "2026-10-02T01:00:00Z",
  end_time: "2026-10-02T05:00:00Z",
  status: "APPROVED",
  enrolled: 42,
  maxEnrollment: 120,
  waitingList: 0,
};

const NOT_ACCESSIBLE = "You don't have access to registration information for that event.";

const ok = (body) => ({ status: 200, ok: true, json: async () => body });
const fail = (status, message) => ({ status, ok: false, json: async () => ({ message }) });

// Unknown URLs answer 404 rather than throwing, so an unexpected request fails
// the page under test visibly instead of surfacing as an unrelated error. The
// test environment also probes fetch() with no arguments, which lands here.
function setup(roles = ["event_organiser"], handlers = {}) {
  getAuthClient.mockResolvedValue({ auth: {
    onAuthStateChange: vi.fn((callback) => {
      queueMicrotask(() => callback("INITIAL_SESSION", { access_token: "token", user: { id: "sdk" } }));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } });
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (url === "/api/auth/me") return ok({
      user: { id: "me", email: "user@example.com", fullName: "Test User", roles, accountTypes: ["external"] },
      permissions: getPermissions(roles),
    });
    if (url === "/api/managed-events") return (handlers.list ?? (() => ok({ events: [SUMMARY] })))();
    if (url === `/api/managed-events/${EVENT_ID}`) return (handlers.detail ?? (() => ok({ summary: SUMMARY })))();
    if (url === `/api/managed-events/${OTHER_EVENT_ID}`) return (handlers.other ?? (() => fail(403, "denied")))();
    return fail(404, "Not found");
  }));
}

const renderAt = (path) =>
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

test("a signed-in organiser reaches My Events from the workspace navigation", async () => {
  setup();
  renderAt("/account");

  await userEvent.click(await screen.findByRole("link", { name: "My Events" }));

  expect(await screen.findByRole("heading", { name: "My Events", level: 1 })).toBeTruthy();
});

test("a coordinator also reaches My Events", async () => {
  setup(["event_coordinator"]);
  renderAt("/account");

  expect(await screen.findByRole("link", { name: "My Events" })).toBeTruthy();
});

test("a role without events.managed.read never sees the My Events tab", async () => {
  setup(["attendee"]);
  renderAt("/account");

  expect(await screen.findByRole("link", { name: "Account" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "My Events" })).toBeNull();
});

test("a role without events.managed.read is sent to the forbidden page by URL", async () => {
  setup(["attendee"]);
  renderAt("/events/managed");

  expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
});

test("the detail view shows the enrolled count against the maximum", async () => {
  setup();
  renderAt(`/events/managed/${EVENT_ID}`);

  expect(await screen.findByRole("heading", { name: "Annual Alumni Gala" })).toBeTruthy();
  const enrolled = (await screen.findByText("Current Registrations")).closest("div");
  expect(enrolled?.textContent).toContain("42/120");
});

test("the detail view shows the waiting list count", async () => {
  setup(["event_organiser"], { detail: () => ok({ summary: { ...SUMMARY, waitingList: 7 } }) });
  renderAt(`/events/managed/${EVENT_ID}`);

  const waiting = (await screen.findByText("Waiting List")).closest("div");
  expect(waiting?.textContent).toContain("7");
});

test("a null maximum renders a dash rather than zero", async () => {
  setup(["event_organiser"], { detail: () => ok({ summary: { ...SUMMARY, enrolled: 0, maxEnrollment: null } }) });
  renderAt(`/events/managed/${EVENT_ID}`);

  const enrolled = (await screen.findByText("Current Registrations")).closest("div");
  expect(enrolled?.textContent).toContain("0/-");
});

test("a null enrolled_attendees reaches the page as zero registrations", async () => {
  setup(["event_organiser"], { detail: () => ok({ summary: { ...SUMMARY, enrolled: 0, maxEnrollment: 30 } }) });
  renderAt(`/events/managed/${EVENT_ID}`);

  const enrolled = (await screen.findByText("Current Registrations")).closest("div");
  expect(enrolled?.textContent).toContain("0/30");
});

test("the list names each event the user owns or manages", async () => {
  setup();
  renderAt("/events/managed");

  expect(await screen.findByRole("link", { name: /Annual Alumni Gala/ })).toBeTruthy();
});

test("clicking an event opens its detail view", async () => {
  setup();
  renderAt("/events/managed");

  await userEvent.click(await screen.findByRole("link", { name: /Annual Alumni Gala/ }));

  expect(await screen.findByRole("heading", { name: "Annual Alumni Gala" })).toBeTruthy();
  expect(await screen.findByText("Waiting List")).toBeTruthy();
});

test("the list shows an empty state when the user owns nothing", async () => {
  setup(["event_organiser"], { list: () => ok({ events: [] }) });
  renderAt("/events/managed");

  expect(await screen.findByText("You do not own or manage any events yet.")).toBeTruthy();
});

test("a list failure surfaces the server's message", async () => {
  setup(["event_organiser"], { list: () => fail(500, "Unable to load your events.") });
  renderAt("/events/managed");

  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Unable to load your events.");
});

test("a 403 and a 404 both show the same not-accessible message", async () => {
  for (const status of [403, 404]) {
    cleanup();
    setup(["event_organiser"], {
      detail: () => fail(status, "You do not have permission to access this information."),
    });
    const view = renderAt(`/events/managed/${EVENT_ID}`);

    expect(await view.findByRole("alert")).toHaveProperty("textContent", NOT_ACCESSIBLE);
    // The denial never leaks a count.
    expect(view.queryByText(/42\/120/)).toBeNull();
    view.unmount();
  }
});

test("a denied detail page still offers a way back to the list", async () => {
  setup(["event_organiser"], { detail: () => fail(403, "denied") });
  renderAt(`/events/managed/${EVENT_ID}`);

  expect(await screen.findByRole("link", { name: "Back to my events" })).toBeTruthy();
});

test("the detail page carries no attendee identity", async () => {
  setup();
  renderAt(`/events/managed/${EVENT_ID}`);

  await screen.findByRole("heading", { name: "Annual Alumni Gala" });
  expect(document.body.textContent).not.toMatch(/attendee|@example\.com/);
});
