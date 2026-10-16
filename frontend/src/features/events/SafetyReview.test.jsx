// @vitest-environment jsdom
// SCRUM-140 through the real App, router and permission guards; only Auth and
// network transport are faked.
import { createRequire } from "node:module";
import { cleanup, render, screen, within } from "@testing-library/react";
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

const EVENT_ID = "bbbbbbbb-0001-0000-0000-000000000000";
const QUEUE = [
  { id: EVENT_ID, name: "Community Health Fair", start_time: "2099-05-01T01:00:00Z", end_time: "2099-05-01T09:00:00Z", expected_attendance: 180 },
  { id: "bbbbbbbb-0002-0000-0000-000000000000", name: "Night Market", start_time: "2099-06-01T11:00:00Z", end_time: "2099-06-01T15:00:00Z", expected_attendance: 400 },
];
const venue = (id, name, capacity, notes) => ({
  id, name, booking_date: "2099-05-01", slots: ["am", "pm"], expected_attendees: 150, capacity,
  room_layout: "Theatre", accessibility_requirements: ["Wheelchair seating"],
  accessibility_features: ["Step-free access", "Hearing loop"], notes,
});
const REVIEW = {
  event: {
    id: EVENT_ID, name: "Community Health Fair", description: "Free screenings", start_time: "2099-05-01T01:00:00Z",
    end_time: "2099-05-01T09:00:00Z", expected_attendance: 180, accessibility_needs: "Two wheelchair users",
    other_comments: "Single entrance; queue outside.",
  },
  venues: [venue("vr-a", "Hall A", 200, "Fire exits on the east wall."), venue("vr-b", "Hall B", 90, "No open flames.")],
  equipment: [{ id: "eq-1", type: "Projector", quantity_requested: 2, technical_requirement: "Mounted at the rear of Hall A" }],
};
const EMPTY_FACTS = {
  event: { ...REVIEW.event, description: null, accessibility_needs: "", other_comments: null },
  venues: [{ ...venue("vr-a", "Hall A", 200, null), accessibility_requirements: [] }],
  equipment: [{ ...REVIEW.equipment[0], technical_requirement: null }],
};

const ok = (body) => ({ status: 200, ok: true, json: async () => body });
const fail = (status, message) => ({ status, ok: false, json: async () => ({ message }) });

function setup(roles = ["safety_officer"], routes = {}) {
  getAuthClient.mockResolvedValue({ auth: {
    onAuthStateChange: vi.fn((callback) => {
      queueMicrotask(() => callback("INITIAL_SESSION", { access_token: "token", user: { id: "sdk" } }));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } });
  const fetchMock = vi.fn(async (url) => {
    if (url === "/api/auth/me") return ok({
      user: { id: "officer-1", email: "safety@connectsphere.sg", fullName: "Safety Officer", roles, accountTypes: ["internal"] },
      // The REAL policy decides, so this test fails if the permission is removed.
      permissions: getPermissions(roles),
    });
    if (routes[url]) return routes[url]();
    throw new Error("Unexpected test request: " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const LIST_URL = "/api/internal/safety-reviews";
const DETAIL_URL = `${LIST_URL}/${EVENT_ID}`;
const open = (path) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

function fact(container, label) {
  const term = within(container).getByText(label, { selector: "dt" });
  return term.nextElementSibling.textContent;
}

test("[SCRUM-140-UI-001] the Safety Officer reaches the queue from the nav and sees each waiting event", async () => {
  setup(["safety_officer"], { [LIST_URL]: () => ok({ events: QUEUE }) });
  const user = userEvent.setup();
  open("/account");

  await user.click(await screen.findByRole("link", { name: "Safety reviews" }));

  expect(await screen.findByRole("heading", { name: "Safety reviews" })).toBeTruthy();
  const items = await screen.findAllByRole("listitem");
  expect(items.map((item) => within(item).getByRole("link").textContent)).toEqual(["Community Health Fair", "Night Market"]);
  expect(items[0].textContent).toContain("180 expected");
  expect(within(items[0]).getByRole("link").getAttribute("href")).toBe(`/safety-reviews/${EVENT_ID}`);
});

test("[SCRUM-140-UI-002] an empty queue says nothing is waiting", async () => {
  setup(["safety_officer"], { [LIST_URL]: () => ok({ events: [] }) });
  open("/safety-reviews");

  expect(await screen.findByText("No events are waiting for a safety review.")).toBeTruthy();
  expect(screen.queryByRole("listitem")).toBeNull();
});

test("[SCRUM-140-UI-003] the detail shows attendance, capacity, layout, emergency access, accessibility, placement, crowd movement and restrictions", async () => {
  setup(["safety_officer"], { [DETAIL_URL]: () => ok(REVIEW) });
  open(`/safety-reviews/${EVENT_ID}`);

  const eventSection = await screen.findByRole("region", { name: "Event" });
  expect(fact(eventSection, "Expected attendance")).toBe("180");
  expect(fact(eventSection, "Accessibility needs")).toBe("Two wheelchair users");
  expect(fact(eventSection, "Crowd movement (organiser's comments)")).toBe("Single entrance; queue outside.");
  const hallA = screen.getByRole("region", { name: /Hall A/ });
  expect(fact(hallA, "Venue capacity")).toBe("200");
  expect(fact(hallA, "Layout")).toBe("Theatre");
  expect(fact(hallA, "Accessibility requested")).toBe("Wheelchair seating");
  expect(fact(hallA, "Venue accessibility features")).toBe("Step-free access, Hearing loop");
  expect(fact(hallA, "Emergency access and restrictions (venue notes)")).toBe("Fire exits on the east wall.");
  const equipment = screen.getByRole("region", { name: "Reserved equipment" });
  expect(equipment.textContent).toContain("Projector × 2");
  expect(equipment.textContent).toContain("Placement and requirements: Mounted at the rear of Hall A");
});

test("[SCRUM-140-UI-004] each confirmed venue is its own section with its own facts", async () => {
  setup(["safety_officer"], { [DETAIL_URL]: () => ok(REVIEW) });
  open(`/safety-reviews/${EVENT_ID}`);

  const venues = await screen.findByRole("region", { name: "Confirmed venues" });
  const sections = within(venues).getAllByRole("region");
  expect(sections).toHaveLength(2);
  expect(sections.map((section) => [fact(section, "Venue capacity"), fact(section, "Emergency access and restrictions (venue notes)")])).toEqual([
    ["200", "Fire exits on the east wall."],
    ["90", "No open flames."],
  ]);
  expect(fact(sections[0], "Confirmed slots")).toBe("AM, PM");
});

test("[SCRUM-140-UI-005] missing safety facts read 'Not provided' rather than blank", async () => {
  setup(["safety_officer"], { [DETAIL_URL]: () => ok(EMPTY_FACTS) });
  open(`/safety-reviews/${EVENT_ID}`);

  const eventSection = await screen.findByRole("region", { name: "Event" });
  expect(fact(eventSection, "Accessibility needs")).toBe("Not provided");
  expect(fact(eventSection, "Crowd movement (organiser's comments)")).toBe("Not provided");
  const hallA = screen.getByRole("region", { name: /Hall A/ });
  expect(fact(hallA, "Accessibility requested")).toBe("Not provided");
  expect(fact(hallA, "Emergency access and restrictions (venue notes)")).toBe("Not provided");
  expect(screen.getByRole("region", { name: "Reserved equipment" }).textContent).toContain("Placement and requirements: Not provided");
});

test("[SCRUM-140-UI-006] the detail offers no way to edit the event", async () => {
  setup(["safety_officer"], { [DETAIL_URL]: () => ok(REVIEW) });
  open(`/safety-reviews/${EVENT_ID}`);

  await screen.findByRole("heading", { name: "Community Health Fair" });
  expect(screen.getByText("Read only. This page shows the event as submitted for its safety review.")).toBeTruthy();
  const page = screen.getByRole("heading", { name: "Community Health Fair" }).closest("section");
  expect(page.querySelector("form, input, textarea, select")).toBeNull();
  expect(within(page).queryAllByRole("button")).toEqual([]);
  expect(within(page).getByRole("link", { name: "Back to safety reviews" })).toBeTruthy();
});

test("[SCRUM-140-UI-007] a failed load shows the server's safe message and recovers on Try again", async () => {
  let attempts = 0;
  setup(["safety_officer"], { [DETAIL_URL]: () => (++attempts === 1 ? fail(500, "Something went wrong. Please try again.") : ok(REVIEW)) });
  const user = userEvent.setup();
  open(`/safety-reviews/${EVENT_ID}`);

  expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong. Please try again.");
  await user.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByRole("heading", { name: "Community Health Fair" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("[SCRUM-140-UI-008] an event no longer awaiting review shows the server's message", async () => {
  setup(["safety_officer"], { [DETAIL_URL]: () => fail(404, "That event is not waiting for a safety review.") });
  open(`/safety-reviews/${EVENT_ID}`);

  expect((await screen.findByRole("alert")).textContent).toBe("That event is not waiting for a safety review.");
  expect(screen.queryByRole("region", { name: "Event" })).toBeNull();
});

test.each([
  ["009", "event_coordinator", "/safety-reviews"],
  ["010", "event_coordinator_lead", `/safety-reviews/${EVENT_ID}`],
  ["011", "venue_staff", "/safety-reviews"],
])("[SCRUM-140-UI-%s] %s gets no nav link and is denied %s without an API call", async (_id, role, path) => {
  const fetchMock = setup([role]);
  open(path);

  expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Safety reviews" })).toBeNull();
  expect(fetchMock.mock.calls.every(([url]) => url === "/api/auth/me")).toBe(true);
});

test("[SCRUM-140-UI-012] an event with no confirmed venue or reserved equipment says so in each section", async () => {
  setup(["safety_officer"], { [DETAIL_URL]: () => ok({ ...REVIEW, venues: [], equipment: [] }) });
  open(`/safety-reviews/${EVENT_ID}`);

  const venues = await screen.findByRole("region", { name: "Confirmed venues" });
  expect(venues.textContent).toContain("No confirmed venue booking.");
  expect(within(venues).queryAllByRole("region")).toEqual([]);
  expect(screen.getByRole("region", { name: "Reserved equipment" }).textContent).toContain("No equipment is reserved for this event.");
});
