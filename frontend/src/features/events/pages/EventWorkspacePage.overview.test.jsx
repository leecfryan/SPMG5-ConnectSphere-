// @vitest-environment jsdom
// SCRUM-161: the Lead's workload overview on /event-management. Only Auth and
// network transport are faked; App, guards, permissions and pages are real.
import "@testing-library/jest-dom/vitest";
import { createRequire } from "node:module";
import { cleanup, configure, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import App from "../../../App";
import { getAuthClient } from "../../../lib/supabase";

const require = createRequire(import.meta.url);
const { getPermissions } = require("../../../../../backend/src/auth/permissions.js");

vi.mock("../../../lib/supabase", () => ({ getAuthClient: vi.fn() }));
// Each test waits for sign-in, the list and the directory before its first
// assertion; the 1s default timed out under a full parallel run.
configure({ asyncUtilTimeout: 3000 });

// One event in each of the seven active statuses, one whose coordinator has
// left the directory, and one cancelled event.
const overviewEvents = [
  { id: "event-ada", name: "Digital skills workshop", status: "APPROVED", coordinator_id: "coord-ada", organiser_id: "organiser-a" },
  { id: "event-ben", name: "Community coding day", status: "CONFIRMED", coordinator_id: "coord-ben", organiser_id: "organiser-b" },
  { id: "event-unassigned", name: "Youth design session", status: "SUBMITTED", coordinator_id: null, organiser_id: "organiser-c" },
  { id: "event-gone", name: "Alumni reunion", status: "APPROVED", coordinator_id: "coord-gone", organiser_id: "organiser-d" },
  { id: "event-review", name: "Robotics open house", status: "UNDER_REVIEW", coordinator_id: "coord-ben", organiser_id: "organiser-a" },
  { id: "event-safety", name: "Harbour fun run", status: "SAFETY_REVIEW", coordinator_id: "coord-ada", organiser_id: "organiser-b" },
  { id: "event-prep", name: "Science fair", status: "PREPARATION", coordinator_id: "coord-ben", organiser_id: "organiser-c" },
  { id: "event-postponed", name: "Book festival", status: "POSTPONED", coordinator_id: "coord-ada", organiser_id: "organiser-d" },
  { id: "event-closed", name: "Winter gala", status: "CANCELLED", coordinator_id: "coord-ada", organiser_id: "organiser-a" },
];
const directoryCoordinators = [
  { id: "coord-ada", name: "Ada Tan", email: "ada@example.test" },
  { id: "coord-ben", name: "Ben Lim", email: "ben@example.test" },
];
const ok = body => ({ ok: true, status: 200, json: async () => body });
const unavailable = message => ({ ok: false, status: 503, json: async () => ({ message }) });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

beforeEach(() => {
  getAuthClient.mockResolvedValue({ auth: {
    onAuthStateChange: vi.fn(callback => {
      queueMicrotask(() => callback("INITIAL_SESSION", { access_token: "token", user: { id: "lead-id" } }));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } });
});

function open({ managerList = () => ok({ events: overviewEvents }), directory = () => ok({ coordinators: directoryCoordinators }) } = {}) {
  vi.stubGlobal("fetch", vi.fn(async url => {
    if (url === "/api/auth/me") return ok({
      user: { id: "lead-id", email: "lead@example.test", fullName: "Coordinator Lead", roles: ["event_coordinator_lead"], accountTypes: ["internal"] },
      // The REAL policy decides, so this test fails if the permission is removed.
      permissions: getPermissions(["event_coordinator_lead"]),
    });
    if (url === "/api/event-workspace/manager") return managerList();
    if (url === "/api/event-workspace/coordinators") return directory();
    if (url.endsWith("/safety-readiness")) return ok({ ready: true, missing: [] });
    const detail = url.match(/^\/api\/event-workspace\/manager\/(.+)$/);
    if (detail) return ok({ event: { ...overviewEvents.find(event => event.id === detail[1]), activity: [] } });
    throw new Error("Unexpected request: " + url);
  }));
  render(<MemoryRouter initialEntries={["/event-management"]}><App /></MemoryRouter>);
}

const rowFor = name => screen.getByRole("link", { name }).closest("tr");
const bodyRows = () => screen.getAllByRole("row").slice(1);
const shownEvents = () => bodyRows().map(row => within(row).getByRole("link").textContent);
const shownStatuses = () => bodyRows().map(row => within(row).getAllByRole("cell")[0].textContent);
const requestsTo = url => fetch.mock.calls.filter(([requested]) => requested === url).length;
const coordinatorOptions = () => within(screen.getByLabelText("Coordinator")).getAllByRole("option").map(option => option.textContent);

test("[SCRUM-161-UI-001] AC1: the Lead sees an event in every active status with its coordinator and opens the event's detail page", async () => {
  open();
  const user = userEvent.setup();

  expect(await screen.findAllByRole("cell", { name: "Ada Tan" })).toHaveLength(3);
  // The seven active statuses come from the AC's lifecycle table, not from the
  // frontend constant, so a status dropped from that constant fails here.
  expect([...new Set(shownStatuses())].sort()).toEqual([
    "Approved – planning", "Confirmed", "Postponed", "Preparation", "Safety review", "Submitted", "Under review",
  ]);
  expect(screen.getByText("8 of 9 events shown")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Winter gala" })).toBeNull();
  expect(rowFor("Digital skills workshop")).toHaveTextContent("Ada Tan");
  expect(rowFor("Community coding day")).toHaveTextContent("Ben Lim");
  expect(rowFor("Youth design session")).toHaveTextContent("Awaiting coordinator");
  expect(rowFor("Alumni reunion")).toHaveTextContent("No longer active");

  const link = screen.getByRole("link", { name: "Digital skills workshop" });
  expect(link).toHaveAttribute("href", "/event-management/event-ada");
  await user.click(link);
  expect(await screen.findByRole("heading", { name: "Digital skills workshop" })).toBeInTheDocument();
});

test("[SCRUM-161-UI-002] AC2: the coordinator filter narrows the overview to one person or to unassigned events", async () => {
  open();
  const user = userEvent.setup();
  await screen.findAllByRole("cell", { name: "Ada Tan" });

  await user.selectOptions(screen.getByLabelText("Coordinator"), "coord-ada");
  expect(shownEvents()).toEqual(["Digital skills workshop", "Harbour fun run", "Book festival"]);
  expect(screen.getByText("3 of 9 events shown")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Coordinator"), "unassigned");
  expect(shownEvents()).toEqual(["Youth design session"]);

  await user.selectOptions(screen.getByLabelText("Coordinator"), "all");
  expect(shownEvents()).toHaveLength(8);
});

test("[SCRUM-161-UI-003] AC2: the status filter lists statuses in lifecycle order, narrows the overview, and All statuses restores the existing view", async () => {
  open();
  const user = userEvent.setup();
  await screen.findAllByRole("cell", { name: "Ada Tan" });
  const statusSelect = screen.getByLabelText("Event status");
  expect(within(statusSelect).getAllByRole("option").map(option => option.textContent)).toEqual([
    "All active statuses", "All statuses", "Submitted", "Under review", "Approved – planning", "Safety review",
    "Preparation", "Confirmed", "Cancelled", "Postponed",
  ]);

  await user.selectOptions(statusSelect, "CONFIRMED");
  expect(shownEvents()).toEqual(["Community coding day"]);
  expect(rowFor("Community coding day")).toHaveTextContent("Confirmed");

  await user.selectOptions(statusSelect, "all");
  expect(shownEvents()).toHaveLength(9);
  expect(screen.getByRole("link", { name: "Winter gala" })).toBeInTheDocument();
});

test("[SCRUM-161-UI-004] AC2 boundary: filters that match nothing say so, and Clear filters restores the default view", async () => {
  open();
  const user = userEvent.setup();
  await screen.findAllByRole("cell", { name: "Ada Tan" });
  expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();

  await user.selectOptions(screen.getByLabelText("Coordinator"), "coord-ada");
  await user.selectOptions(screen.getByLabelText("Event status"), "CONFIRMED");
  expect(screen.getByText("No events match these filters. Clear the filters to see every active event.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();

  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByLabelText("Coordinator")).toHaveValue("all");
  expect(screen.getByLabelText("Event status")).toHaveValue("active");
  expect(shownEvents()).toHaveLength(8);
  expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
});

test("[SCRUM-161-UI-005] AC1 failure: an unavailable overview shows a safe message, no stale list, and Refresh recovers", async () => {
  let attempts = 0;
  open({ managerList: () => (attempts += 1) === 1 ? unavailable("Unable to load events. Please try again.") : ok({ events: overviewEvents }) });
  const user = userEvent.setup();

  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load events. Please try again.");
  expect(screen.queryByRole("table")).toBeNull();

  await user.click(screen.getByRole("button", { name: "Refresh events" }));
  expect(await screen.findByRole("link", { name: "Digital skills workshop" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});

// A directory outage must not hide the assignments or claim their owners have
// left, and the filters keep working without the names.
test("[SCRUM-161-UI-006] AC1/AC2 failure: a directory failure keeps the overview usable and does not invent an outcome", async () => {
  open({ directory: () => unavailable("Coordinator names are unavailable right now.") });
  const user = userEvent.setup();

  expect(await screen.findByRole("alert")).toHaveTextContent("Coordinator names are unavailable right now.");
  expect(rowFor("Digital skills workshop")).toHaveTextContent("Coordinator assigned");
  expect(rowFor("Youth design session")).toHaveTextContent("Awaiting coordinator");
  expect(screen.queryByText("No longer active")).toBeNull();
  expect(coordinatorOptions()).toEqual(["All coordinators", "Awaiting coordinator"]);

  await user.selectOptions(screen.getByLabelText("Coordinator"), "unassigned");
  expect(shownEvents()).toEqual(["Youth design session"]);
});

test("[SCRUM-161-UI-007] AC1 boundary: an overview with only closed events says so, and a status the labels do not know stays selectable", async () => {
  open({ managerList: () => ok({ events: [
    { id: "event-closed", name: "Winter gala", status: "CANCELLED", coordinator_id: "coord-ada", organiser_id: "organiser-a" },
    { id: "event-unknown", name: "Retired pilot", status: "ON_HOLD", coordinator_id: null, organiser_id: "organiser-b" },
  ] }) });
  const user = userEvent.setup();

  expect(await screen.findByText("No active events right now. Choose All statuses to see closed events.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  expect(within(screen.getByLabelText("Event status")).getAllByRole("option").at(-1)).toHaveTextContent("ON_HOLD");

  await user.selectOptions(screen.getByLabelText("Event status"), "all");
  expect(shownEvents()).toEqual(["Winter gala", "Retired pilot"]);
});

test("[SCRUM-161-UI-008] AC2: Refresh events reloads the list without discarding the Lead's filters or a loaded directory", async () => {
  open();
  const user = userEvent.setup();
  await screen.findAllByRole("cell", { name: "Ada Tan" });
  await user.selectOptions(screen.getByLabelText("Coordinator"), "coord-ben");

  await user.click(screen.getByRole("button", { name: "Refresh events" }));
  expect(await screen.findByRole("link", { name: "Community coding day" })).toBeInTheDocument();
  expect(requestsTo("/api/event-workspace/manager")).toBe(2);
  expect(requestsTo("/api/event-workspace/coordinators")).toBe(1);
  expect(screen.getByLabelText("Coordinator")).toHaveValue("coord-ben");
  expect(shownEvents()).toEqual(["Community coding day", "Robotics open house", "Science fair"]);
});

// The directory names only active coordinators, so assignments held by someone
// who has left the role are filtered together under "No longer active".
test("[SCRUM-161-UI-009] AC2: the coordinator filter reaches events whose coordinator is no longer active", async () => {
  open();
  const user = userEvent.setup();
  await screen.findAllByRole("cell", { name: "Ada Tan" });
  expect(coordinatorOptions()).toEqual(["All coordinators", "Awaiting coordinator", "Ada Tan", "Ben Lim", "No longer active"]);

  await user.selectOptions(screen.getByLabelText("Coordinator"), "departed");
  expect(shownEvents()).toEqual(["Alumni reunion"]);
});

test("[SCRUM-161-UI-010] AC1/AC2 failure: Refresh events retries a failed directory, restoring names and coordinator options", async () => {
  let attempts = 0;
  open({ directory: () => (attempts += 1) === 1 ? unavailable("Coordinator names are unavailable right now.") : ok({ coordinators: directoryCoordinators }) });
  const user = userEvent.setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("Coordinator names are unavailable right now.");

  await user.click(screen.getByRole("button", { name: "Refresh events" }));
  expect(await screen.findAllByRole("cell", { name: "Ada Tan" })).toHaveLength(3);
  expect(requestsTo("/api/event-workspace/coordinators")).toBe(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(coordinatorOptions()).toContain("Ben Lim");
});
