// @vitest-environment jsdom
// only Auth and network transport are faked.
import { createRequire } from "node:module";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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

const QUEUE = [
  { id: "aaaaaaaa-0001-0000-0000-000000000000", name: "Digital Literacy for Seniors",
    status: "SUBMITTED", coordinator_id: null, purpose: "Teach basic digital skills",
    description: "Six weekly sessions.", start_time: "2026-10-02T01:00:00Z",
    end_time: "2026-10-02T05:00:00Z", expected_attendance: 30,
    venue_requirements: "Step-free room", accessibility_needs: null,
    equipment_needs: "Laptops", other_comments: null, submitted_at: "2026-09-01T00:00:00Z" },
  { id: "aaaaaaaa-0002-0000-0000-000000000000", name: "Parent & Child Coding Workshop",
    status: "SUBMITTED", coordinator_id: null, purpose: "Families code together",
    description: "One afternoon.", start_time: "2026-11-07T01:00:00Z",
    end_time: "2026-11-07T04:00:00Z", expected_attendance: 24,
    venue_requirements: null, accessibility_needs: null, equipment_needs: null,
    other_comments: null, submitted_at: "2026-09-08T00:00:00Z" },
];
const COORDINATORS = [
  { id: "coord-1", fullName: "Ada Tan", email: "ada@example.com", activeEvents: 2, nextEventStart: "2026-10-20T13:00:00Z" },
  { id: "coord-2", fullName: "Ben Lim", email: "ben@example.com", activeEvents: 0, nextEventStart: null },
];

const ok = (body) => ({ status: 200, ok: true, json: async () => body });
const fail = (status, message) => ({ status, ok: false, json: async () => ({ message }) });

let handlers;
beforeEach(() => { handlers = {}; });

function setup(roles = ["event_ops_manager"], { queue = QUEUE } = {}) {
  getAuthClient.mockResolvedValue({ auth: {
    onAuthStateChange: vi.fn((callback) => {
      queueMicrotask(() => callback("INITIAL_SESSION", { access_token: "token", user: { id: "sdk" } }));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } });
  const fetchMock = vi.fn(async (url, options) => {
    if (url === "/api/auth/me") return ok({
      user: { id: "manager", email: "ops@connectsphere.sg", fullName: "Ops Manager", roles, accountTypes: ["internal"] },
      // The REAL policy decides, so this test fails if the permission is removed.
      permissions: getPermissions(roles),
    });
    if (url === "/api/internal/events/unassigned") return ok({ events: queue });
    if (url === "/api/internal/coordinators") return ok({ coordinators: COORDINATORS });
    if (url.endsWith("/coordinator")) return (handlers.assign ?? ((u, o) => ok({ event: { id: "x", coordinator_id: JSON.parse(o.body).coordinatorId } })))(url, options);
    throw new Error("Unexpected test request: " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const open = () => render(<MemoryRouter initialEntries={["/events/assignments"]}><App /></MemoryRouter>);

async function openQueueAndSelect(name = "Digital Literacy for Seniors") {
  setup();
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole("button", { name: new RegExp(name) }));
  return user;
}

test("[SCRUM-26-UI-001] the Event Operations Manager reaches the queue and sees it in the workspace nav", async () => {
  setup();
  open();
  expect(await screen.findByRole("heading", { name: "Assign an Event Coordinator" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Assign coordinators" })).toBeTruthy();
});

test.each([["event_coordinator"], ["venue_staff"], ["technical_support_staff"], ["event_organiser"], ["attendee"]])(
  "[SCRUM-26-UI-002] %s is redirected away from the assignment queue", async (role) => {
    setup([role]);
    open();
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Assign an Event Coordinator" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Assign coordinators" })).toBeNull();
  });

test("[SCRUM-26-UI-003] the queue lists submitted requests in the order the server returned them", async () => {
  setup();
  open();
  const items = await screen.findAllByRole("button", { name: /Ref AAAAAAAA/ });
  expect(items.map((item) => item.textContent)).toEqual([
    expect.stringContaining("Digital Literacy for Seniors"),
    expect.stringContaining("Parent & Child Coding Workshop"),
  ]);
});

test("[SCRUM-26-UI-004] an empty queue is a plain statement, not an error", async () => {
  setup(["event_ops_manager"], { queue: [] });
  open();
  expect(await screen.findByText("No submitted requests are waiting for a coordinator.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("[SCRUM-26-UI-005] the request's details are read-only: nothing on the page can be typed into", async () => {
  await openQueueAndSelect();
  expect(await screen.findByRole("heading", { name: "Digital Literacy for Seniors" })).toBeTruthy();
  expect(screen.getByText("Teach basic digital skills")).toBeTruthy();
  // Amending a request belongs to the Event Coordinator (US-36/US-37). The
  // manager has no edit endpoint, and the page offers no way to ask for one.
  for (const role of ["textbox", "combobox", "spinbutton", "checkbox", "slider"]) {
    expect(screen.queryAllByRole(role)).toHaveLength(0);
  }
});

test("[SCRUM-26-UI-006] assigning is the one action, and it needs a coordinator chosen first", async () => {
  const user = await openQueueAndSelect();
  await user.click(await screen.findByRole("button", { name: "Assign coordinator" }));

  const button = await screen.findByRole("button", { name: "Select a coordinator" });
  expect(button.disabled).toBe(true);

  await user.click(screen.getByRole("radio", { name: "Assign to Ada Tan" }));
  const ready = screen.getByRole("button", { name: "Assign to Ada Tan" });
  expect(ready.disabled).toBe(false);
});

test("[SCRUM-26-UI-007] the coordinator table shows workload without turning it into a rule", async () => {
  const user = await openQueueAndSelect();
  await user.click(await screen.findByRole("button", { name: "Assign coordinator" }));

  const table = await screen.findByRole("table");
  const [ada, ben] = within(table).getAllByRole("row").slice(1);
  expect(within(ada).getByText("2")).toBeTruthy();
  // Clarification #4: coordinators may hold several events at once, so a busy
  // coordinator is still selectable and an idle one shows 0 rather than blank.
  expect(within(ben).getByText("0")).toBeTruthy();
  for (const row of [ada, ben]) {
    expect(within(row).getByRole("radio").disabled).toBe(false);
  }
});

test("[SCRUM-26-UI-008] a successful assignment confirms and removes the request from the queue", async () => {
  const fetchMock = setup();
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole("button", { name: /Digital Literacy for Seniors/ }));
  await user.click(await screen.findByRole("button", { name: "Assign coordinator" }));
  await user.click(await screen.findByRole("radio", { name: "Assign to Ada Tan" }));
  await user.click(screen.getByRole("button", { name: "Assign to Ada Tan" }));

  expect(await screen.findByText("Digital Literacy for Seniors is now assigned to Ada Tan.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Digital Literacy for Seniors/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Parent & Child Coding Workshop/ })).toBeTruthy();

  const [url, options] = fetchMock.mock.calls.find(([value]) => String(value).endsWith("/coordinator"));
  expect(url).toBe("/api/internal/events/aaaaaaaa-0001-0000-0000-000000000000/coordinator");
  expect(options.method).toBe("PUT");
  expect(JSON.parse(options.body)).toEqual({ coordinatorId: "coord-1" });
});

test("[SCRUM-26-UI-009] a request another manager already took explains itself and offers a refresh", async () => {
  setup();
  handlers.assign = () => fail(409, "This request was assigned by someone else. Refresh to see the current queue.");
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole("button", { name: /Digital Literacy for Seniors/ }));
  await user.click(await screen.findByRole("button", { name: "Assign coordinator" }));
  await user.click(await screen.findByRole("radio", { name: "Assign to Ada Tan" }));
  await user.click(screen.getByRole("button", { name: "Assign to Ada Tan" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/assigned by someone else/i);
  // Without this the manager retries the same click.
  expect(within(alert).getByRole("button", { name: "Refresh the queue" })).toBeTruthy();
});

test("[SCRUM-26-UI-010] a failure that is the manager's to fix does not offer a pointless refresh", async () => {
  setup();
  handlers.assign = () => fail(422, "That person is not an Event Coordinator.");
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole("button", { name: /Digital Literacy for Seniors/ }));
  await user.click(await screen.findByRole("button", { name: "Assign coordinator" }));
  await user.click(await screen.findByRole("radio", { name: "Assign to Ada Tan" }));
  await user.click(screen.getByRole("button", { name: "Assign to Ada Tan" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/not an Event Coordinator/i);
  expect(within(alert).queryByRole("button", { name: "Refresh the queue" })).toBeNull();
  // The request stays in the queue: nothing was assigned.
  expect(screen.getByRole("button", { name: /Digital Literacy for Seniors/ })).toBeTruthy();
});
