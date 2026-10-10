// @vitest-environment jsdom
// Only Auth and network transport are faked; App, guards, pages and services are real.
import "@testing-library/jest-dom/vitest";
import { createRequire } from "node:module";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import App from "../../../App";
import { getAuthClient } from "../../../lib/supabase";

const require = createRequire(import.meta.url);
const { getPermissions } = require("../../../../../backend/src/auth/permissions.js");

vi.mock("../../../lib/supabase", () => ({ getAuthClient: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

const EVENT_ID = "aaaaaaaa-0098-4000-8000-000000000002";
const ROLES = { coordinator: ["event_coordinator"], organiser: ["event_organiser"], manager: ["event_ops_manager"] };
const PATHS = { coordinator: "/assigned-events", organiser: "/my-event-requests", manager: "/event-management" };
// 2099-10-05T02:30:00Z is 10:30 am on 5 Oct in Asia/Singapore (vitest.config TZ).
const DECISION = { approved_rejected_by: "coord-1", approved_rejected_by_name: "Ada Tan", approved_rejected_at: "2099-10-05T02:30:00Z", approval_rejection_remark: "Ready for planning." };

const ok = (body) => ({ status: 200, ok: true, json: async () => body });

function setup(scope, initial, { userId = "coord-1", events } = {}) {
  let event = { id: EVENT_ID, name: "Digital Literacy for Seniors", coordinator_id: "coord-1", organiser_id: "org-1",
    purpose: "Teach basic digital skills", approved_rejected_at: null, approved_rejected_by_name: null, ...initial };
  getAuthClient.mockResolvedValue({ auth: {
    onAuthStateChange: vi.fn((callback) => {
      queueMicrotask(() => callback("INITIAL_SESSION", { access_token: "token", user: { id: "sdk" } }));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } });
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (url === "/api/auth/me") return ok({
      user: { id: userId, email: "staff@connectsphere.sg", fullName: "Staff", roles: ROLES[scope], accountTypes: ["internal"] },
      // The REAL policy decides, so this test fails if the permission is removed.
      permissions: getPermissions(ROLES[scope]),
    });
    if (url === `/api/event-workspace/${scope}`) return ok({ events: events ?? [event] });
    if (url === `/api/event-workspace/${scope}/${EVENT_ID}`) return ok({ event });
    if (url === "/api/event-workspace/coordinators") return ok({ coordinators: [] });
    if (url === `/api/internal/events/${EVENT_ID}/safety-readiness`) return ok({ ready: true, missing: [] });
    if (options.method === "POST" && url.endsWith("/submit-safety-check")) event = { ...event, status: "SAFETY_REVIEW" };
    else if (options.method === "POST" && url.endsWith("/withdraw-safety-check")) event = { ...event, status: "APPROVED" };
    else if (options.method === "POST" && url.endsWith("/start-review")) event = { ...event, status: "UNDER_REVIEW" };
    else if (options.method === "POST" && url.endsWith("/approve")) event = { ...event, status: "APPROVED", ...DECISION };
    else if (options.method === "POST" && url.endsWith("/reject")) event = { ...event, status: "REJECTED", ...DECISION, approval_rejection_remark: JSON.parse(options.body).note };
    else throw new Error("Unexpected test request: " + url);
    return ok({ event });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter initialEntries={[`${PATHS[scope]}/${EVENT_ID}`]}><App /></MemoryRouter>);
  return { fetchMock, user: userEvent.setup() };
}

const posts = (fetchMock) => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST").map(([url]) => url);

function detail(region, label) {
  const term = within(region).getByText(label, { selector: "dt" });
  return within(term.parentElement).getByRole("definition").textContent;
}

test("[SCRUM-98-UI-009] AC2: the assigned coordinator starts review and the page then shows Under review", async () => {
  const { fetchMock, user } = setup("coordinator", { status: "SUBMITTED" });
  expect(await screen.findByText("Submitted", { selector: ".status-badge" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Start review" }));

  expect(await screen.findByText("Under review", { selector: ".status-badge" })).toBeInTheDocument();
  expect(posts(fetchMock)).toEqual([`/api/internal/events/${EVENT_ID}/start-review`]);
  expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
});

test("[SCRUM-99-UI-009] AC1/AC3: approving shows Approved – planning with the approver and time on the reloaded page", async () => {
  const { fetchMock, user } = setup("coordinator", { status: "UNDER_REVIEW" });
  await user.type(await screen.findByLabelText("Decision note"), "Ready for planning.");
  await user.click(screen.getByRole("button", { name: "Approve" }));

  const summary = await screen.findByRole("region", { name: "Review decision" });
  expect(detail(summary, "Outcome")).toBe("Approved – planning");
  expect(detail(summary, "Decided by")).toBe("Ada Tan");
  expect(detail(summary, "Decided on")).toMatch(/(5 Oct|Oct 5),? 2099.*10:30/);
  expect(detail(summary, "Note")).toBe("Ready for planning.");
  expect(posts(fetchMock)).toEqual([`/api/internal/events/${EVENT_ID}/approve`]);
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  // SCRUM-99 AC1: planning can begin once approved.
  expect(screen.getByRole("link", { name: "Arrange venue bookings" })).toBeInTheDocument();
});

test("[SCRUM-98-UI-012] AC3: rejecting shows Rejected and the reason on the reloaded page", async () => {
  const { fetchMock, user } = setup("coordinator", { status: "UNDER_REVIEW" });
  await user.type(await screen.findByLabelText("Decision note"), "Dates clash with exams.");
  await user.click(screen.getByRole("button", { name: "Reject" }));

  const summary = await screen.findByRole("region", { name: "Review decision" });
  expect(detail(summary, "Outcome")).toBe("Rejected");
  expect(detail(summary, "Reason")).toBe("Dates clash with exams.");
  expect(screen.getByText("Rejected", { selector: ".status-badge" })).toBeInTheDocument();
  expect(posts(fetchMock)).toEqual([`/api/internal/events/${EVENT_ID}/reject`]);
  expect(screen.queryByRole("link", { name: "Arrange venue bookings" })).not.toBeInTheDocument();
});

test("[SCRUM-139-UI-009] AC3/AC4: submitting shows Safety review and locks arrangements; withdrawing reopens them", async () => {
  const { fetchMock, user } = setup("coordinator", { status: "APPROVED", ...DECISION });
  expect(await screen.findByRole("link", { name: "Arrange venue bookings" })).toBeInTheDocument();

  await user.click(await screen.findByRole("button", { name: "Submit for safety check", disabled: false }));

  expect(await screen.findByText("Safety review", { selector: ".status-badge" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Arrange venue bookings" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Arrange equipment and technical support" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Withdraw from safety check" }));

  expect(await screen.findByText("Approved – planning", { selector: ".status-badge" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Arrange venue bookings" })).toBeInTheDocument();
  expect(posts(fetchMock)).toEqual([
    `/api/internal/events/${EVENT_ID}/submit-safety-check`,
    `/api/internal/events/${EVENT_ID}/withdraw-safety-check`,
  ]);
});

test.each([["organiser", "org-1"], ["manager", "manager-1"], ["coordinator", "coord-2"]])(
  "[SCRUM-139-UI-010] AC3: the %s who is not the assigned coordinator sees no safety-check controls", async (scope, userId) => {
    const { fetchMock } = setup(scope, { status: "APPROVED", ...DECISION }, { userId });

    expect(await screen.findByRole("heading", { name: "Digital Literacy for Seniors" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Operational Safety Check" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.includes("safety"))).toBe(false);
  });

test.each(["organiser", "manager"])("[SCRUM-99-UI-010] AC3: the %s sees the decision, the approver and the time, with no review actions", async (scope) => {
  setup(scope, { status: "APPROVED", ...DECISION }, { userId: scope === "organiser" ? "org-1" : "manager-1" });

  const summary = await screen.findByRole("region", { name: "Review decision" });
  expect(detail(summary, "Outcome")).toBe("Approved – planning");
  expect(detail(summary, "Decided by")).toBe("Ada Tan");
  expect(detail(summary, "Decided on")).toMatch(/(5 Oct|Oct 5),? 2099.*10:30/);
  expect(detail(summary, "Note")).toBe("Ready for planning.");
  for (const name of ["Start review", "Approve", "Reject"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
});

test.each(["SUBMITTED", "UNDER_REVIEW"])("[SCRUM-98-UI-010] AC4: a coordinator who is not assigned sees no review actions on a %s event", async (status) => {
  setup("coordinator", { status, coordinator_id: "coord-2" });

  expect(await screen.findByRole("heading", { name: "Digital Literacy for Seniors" })).toBeInTheDocument();
  for (const name of ["Start review", "Approve", "Reject"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
});

test("[SCRUM-98-UI-011] SCRUM-97 AC4: the coordinator's list shows each status in words", async () => {
  const events = [
    { id: EVENT_ID, name: "Digital Literacy for Seniors", status: "UNDER_REVIEW", coordinator_id: "coord-1" },
    { id: "aaaaaaaa-0098-4000-8000-000000000003", name: "Parent & Child Coding Workshop", status: "APPROVED", coordinator_id: "coord-1" },
  ];
  setup("coordinator", {}, { events });
  await userEvent.setup().click(await screen.findByRole("link", { name: "Back to my assigned events" }));

  const list = await screen.findByRole("list");
  expect(within(list).getByText("Under review", { selector: ".status-badge" })).toBeInTheDocument();
  expect(within(list).getByText("Approved – planning", { selector: ".status-badge" })).toBeInTheDocument();
  expect(within(list).queryByText("UNDER_REVIEW")).not.toBeInTheDocument();
});

// SCRUM-100: the responsible organiser edits their event; colleagues get a view-only page.
const eventId = "10000000-0000-0000-0000-000000000001";
const endpoint = `/api/event-workspace/organiser/${eventId}`;
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function setupOrganiserEdit({ owner = "organiser-a", patchResponse } = {}) {
  const event = {
    id: eventId, organiser_id: owner, coordinator_id: null, status: "APPROVED", name: "Own event",
    purpose: "Workshop", description: "An accessible workshop", expected_attendance: 20,
    start_time: "2099-01-01T01:00:12.345Z", end_time: "2099-01-01T03:00:12.345Z",
    venue_requirements: "One room", equipment_needs: "Projector",
  };
  const identity = { id: "organiser-a", roles: ["event_organiser"], fullName: "Organiser A", accountTypes: ["external"] };
  let authListener;
  const session = { access_token: "organiser-token", user: { id: "sdk-id" } };
  getAuthClient.mockResolvedValue({ auth: {
    onAuthStateChange: callback => {
      authListener = callback;
      queueMicrotask(() => callback("INITIAL_SESSION", session));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } });
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (url === "/api/auth/me") return response(200, {
      user: { ...identity },
      permissions: getPermissions(["event_organiser"]),
    });
    if (url === endpoint && options.method === "PATCH") {
      if (patchResponse) return patchResponse;
      Object.assign(event, JSON.parse(options.body));
      return response(200, { event: { ...event } });
    }
    if (url === endpoint) return response(200, { event: { ...event } });
    throw new Error("Unexpected request: " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter initialEntries={[`/my-event-requests/${eventId}`]}><App /></MemoryRouter>);
  return { event, fetchMock, switchAccount: () => {
    identity.id = "organiser-b";
    authListener("SIGNED_IN", { access_token: "other-organiser-token", user: { id: "unverified-b" } });
  } };
}

test("[SCRUM-100-UI-001] The responsible organiser saves only changed fields and sees the refreshed event", async () => {
  const { event, fetchMock } = setupOrganiserEdit();
  const before = structuredClone(event);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit event" }));
  expect(screen.getByRole("button", { name: "Save changes" }).disabled).toBe(true);
  const input = screen.getByLabelText(/Event name/);
  await user.clear(input);
  await user.type(input, "Revised event");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("heading", { name: "Revised event" });
  expect(screen.getByText("Event changes saved.")).toBeTruthy();
  const calls = fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH");
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][1].body)).toEqual({ name: "Revised event" });
  expect(event).toEqual({ ...before, name: "Revised event" });
});

test("[SCRUM-100-UI-002] A colleague's event has a view-only explanation and no edit controls", async () => {
  const { fetchMock } = setupOrganiserEdit({ owner: "organiser-b" });
  await screen.findByRole("heading", { name: "Own event" });
  expect(screen.getByText("View only. Only the responsible organiser can edit this event.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Edit event" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
});

test("[SCRUM-100-UI-003] Cancelling an edit discards form input without sending any update", async () => {
  const { fetchMock } = setupOrganiserEdit();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit event" }));
  await user.type(screen.getByLabelText(/Event name/), "Discard this");
  await user.click(screen.getByRole("button", { name: "Cancel editing" }));
  expect(screen.getByRole("button", { name: "Edit event" })).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
});

test("[SCRUM-100-UI-004] API validation errors retain entered values and allow correction", async () => {
  setupOrganiserEdit({ patchResponse: response(400, { errors: [{ field: "name", message: "required" }], message: "Check the event details and try again." }) });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit event" }));
  await user.clear(screen.getByLabelText(/Event name/));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("required")).toBeTruthy();
  expect(screen.getByLabelText(/Event name/).value).toBe("");
  expect(screen.getByLabelText(/Event name/).getAttribute("aria-invalid")).toBe("true");
});

test("[SCRUM-100-UI-005] A server denial of an already open edit retains input and leaves stored data unchanged", async () => {
  const { event } = setupOrganiserEdit({ patchResponse: response(403, { message: "You can only edit events you are responsible for." }) });
  const before = structuredClone(event);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit event" }));
  await user.type(screen.getByLabelText(/Event name/), "Denied change");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("You can only edit events you are responsible for."));
  expect(event).toEqual(before);
  expect(screen.getByLabelText(/Event name/).value).toBe("Own eventDenied change");
});

test("[SCRUM-100-UI-006] Late event data cannot restore a previous account's records after an account switch", async () => {
  const { fetchMock, event, switchAccount } = setupOrganiserEdit();
  await screen.findByRole("heading", { name: "Own event" });
  const original = fetchMock.getMockImplementation();
  let finishOldRequest;
  fetchMock.mockImplementation((url, options) => {
    if (url === endpoint && options.headers.Authorization === "Bearer organiser-token") {
      return new Promise(resolve => { finishOldRequest = resolve; });
    }
    if (url === endpoint) return Promise.resolve(response(404, { message: "Event not found." }));
    return original(url, options);
  });
  await userEvent.setup().click(screen.getByRole("button", { name: "Refresh event" }));
  await waitFor(() => expect(finishOldRequest).toBeTypeOf("function"));
  await act(async () => switchAccount());
  await screen.findByText("Event not found.");
  await act(async () => finishOldRequest(response(200, { event })));
  expect(screen.queryByRole("heading", { name: "Own event" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit event" })).toBeNull();
});
