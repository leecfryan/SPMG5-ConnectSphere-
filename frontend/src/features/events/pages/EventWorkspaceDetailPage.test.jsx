// @vitest-environment jsdom
// Only Auth and network transport are faked; App, guards, pages and services are real.
import "@testing-library/jest-dom/vitest";
import { createRequire } from "node:module";
import { cleanup, render, screen, within } from "@testing-library/react";
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
const DECISION = { decided_by: "coord-1", decided_by_name: "Ada Tan", decided_at: "2099-10-05T02:30:00Z", decision_note: "Ready for planning." };

const ok = (body) => ({ status: 200, ok: true, json: async () => body });

function setup(scope, initial, { userId = "coord-1", events } = {}) {
  let event = { id: EVENT_ID, name: "Digital Literacy for Seniors", coordinator_id: "coord-1", organiser_id: "org-1",
    purpose: "Teach basic digital skills", decided_at: null, decided_by_name: null, ...initial };
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
    if (options.method === "POST" && url.endsWith("/start-review")) event = { ...event, status: "UNDER_REVIEW" };
    else if (options.method === "POST" && url.endsWith("/approve")) event = { ...event, status: "APPROVED", ...DECISION };
    else if (options.method === "POST" && url.endsWith("/reject")) event = { ...event, status: "REJECTED", ...DECISION, decision_note: JSON.parse(options.body).note };
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
