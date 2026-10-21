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

const EVENTS = [
  { id: "event-ada", name: "Digital skills workshop", status: "APPROVED", coordinator_id: "coord-ada", organiser_id: "organiser-a" },
  { id: "event-ben", name: "Community coding day", status: "CONFIRMED", coordinator_id: "coord-ben", organiser_id: "organiser-b" },
  { id: "event-unassigned", name: "Youth design session", status: "SUBMITTED", coordinator_id: null, organiser_id: "organiser-c" },
  // Assigned to someone the directory no longer lists: a deactivated account.
  { id: "event-gone", name: "Alumni reunion", status: "APPROVED", coordinator_id: "coord-gone", organiser_id: "organiser-d" },
  { id: "event-closed", name: "Winter gala", status: "CANCELLED", coordinator_id: "coord-ada", organiser_id: "organiser-a" },
];
const COORDINATORS = [
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

function open({ managerList = () => ok({ events: EVENTS }), directory = () => ok({ coordinators: COORDINATORS }) } = {}) {
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
    if (detail) return ok({ event: { ...EVENTS.find(event => event.id === detail[1]), activity: [] } });
    throw new Error("Unexpected request: " + url);
  }));
  render(<MemoryRouter initialEntries={["/event-management"]}><App /></MemoryRouter>);
}

const rowFor = name => screen.getByRole("link", { name }).closest("tr");
const shownEvents = () => screen.getAllByRole("row").slice(1).map(row => within(row).getByRole("link").textContent);

test("[SCRUM-161-UI-001] AC1: the Lead sees every active event with its coordinator and opens the event's detail page", async () => {
  open();
  const user = userEvent.setup();

  const link = await screen.findByRole("link", { name: "Digital skills workshop" });
  expect(await screen.findByRole("cell", { name: "Ada Tan" })).toBeInTheDocument();
  expect(link).toHaveAttribute("href", "/event-management/event-ada");
  expect(rowFor("Digital skills workshop")).toHaveTextContent("Approved – planning");
  expect(rowFor("Digital skills workshop")).toHaveTextContent("Ada Tan");
  expect(rowFor("Community coding day")).toHaveTextContent("Ben Lim");
  expect(rowFor("Youth design session")).toHaveTextContent("Awaiting coordinator");
  expect(rowFor("Alumni reunion")).toHaveTextContent("No longer active");
  // AC1: the overview opens on active events; the cancelled one waits behind "All statuses".
  expect(screen.queryByRole("link", { name: "Winter gala" })).toBeNull();
  expect(screen.getByText("4 of 5 events shown")).toBeInTheDocument();

  await user.click(link);
  expect(await screen.findByRole("heading", { name: "Digital skills workshop" })).toBeInTheDocument();
});

test("[SCRUM-161-UI-002] AC2: the coordinator filter narrows the overview to one person or to unassigned events", async () => {
  open();
  const user = userEvent.setup();
  await screen.findByRole("cell", { name: "Ada Tan" });

  await user.selectOptions(screen.getByLabelText("Coordinator"), "coord-ada");
  expect(shownEvents()).toEqual(["Digital skills workshop"]);
  expect(screen.getByText("1 of 5 events shown")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("Coordinator"), "unassigned");
  expect(shownEvents()).toEqual(["Youth design session"]);

  await user.selectOptions(screen.getByLabelText("Coordinator"), "all");
  expect(shownEvents()).toHaveLength(4);
});

test("[SCRUM-161-UI-003] AC2: the status filter lists statuses in lifecycle order, narrows the overview, and All statuses restores the existing view", async () => {
  open();
  const user = userEvent.setup();
  await screen.findByRole("cell", { name: "Ada Tan" });
  const statusSelect = screen.getByLabelText("Event status");
  expect(within(statusSelect).getAllByRole("option").map(option => option.textContent)).toEqual([
    "All active statuses", "All statuses", "Submitted", "Approved – planning", "Confirmed", "Cancelled",
  ]);

  await user.selectOptions(statusSelect, "CONFIRMED");
  expect(shownEvents()).toEqual(["Community coding day"]);
  expect(rowFor("Community coding day")).toHaveTextContent("Confirmed");

  await user.selectOptions(statusSelect, "all");
  expect(shownEvents()).toHaveLength(5);
  expect(screen.getByRole("link", { name: "Winter gala" })).toBeInTheDocument();
});

test("[SCRUM-161-UI-004] AC2 boundary: filters that match nothing say so, and Clear filters restores the default view", async () => {
  open();
  const user = userEvent.setup();
  await screen.findByRole("cell", { name: "Ada Tan" });
  expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();

  await user.selectOptions(screen.getByLabelText("Coordinator"), "coord-ada");
  await user.selectOptions(screen.getByLabelText("Event status"), "CONFIRMED");
  expect(screen.getByText("No events match these filters. Clear the filters to see every active event.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();

  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByLabelText("Coordinator")).toHaveValue("all");
  expect(screen.getByLabelText("Event status")).toHaveValue("active");
  expect(shownEvents()).toHaveLength(4);
  expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
});

test("[SCRUM-161-UI-005] AC1 failure: an unavailable overview shows a safe message, no stale list, and Refresh recovers", async () => {
  let attempts = 0;
  open({ managerList: () => (attempts += 1) === 1 ? unavailable("Unable to load events. Please try again.") : ok({ events: EVENTS }) });
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

test("[SCRUM-161-UI-008] AC2: Refresh events reloads the list without discarding the Lead's filters", async () => {
  open();
  const user = userEvent.setup();
  await screen.findByRole("cell", { name: "Ada Tan" });
  await user.selectOptions(screen.getByLabelText("Coordinator"), "coord-ben");

  await user.click(screen.getByRole("button", { name: "Refresh events" }));
  expect(await screen.findByRole("link", { name: "Community coding day" })).toBeInTheDocument();
  expect(fetch.mock.calls.filter(([url]) => url === "/api/event-workspace/manager")).toHaveLength(2);
  expect(screen.getByLabelText("Coordinator")).toHaveValue("coord-ben");
  expect(shownEvents()).toEqual(["Community coding day"]);
});
