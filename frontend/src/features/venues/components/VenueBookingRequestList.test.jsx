// @vitest-environment jsdom
// SCRUM-138: the check button on the event-scoped booking list, end to end
// through the real router and permission policy. Only Auth and network
// transport are faked, so this fails if the route, the guard or the API path
// changes.

import { createRequire } from "node:module";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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

const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const VENUE_ID = "11111111-1111-4111-8111-111111111111";
const CHECKS_URL = `/api/venues/events/${EVENT_ID}/booking-checks`;

const REQUEST = {
  id: "33333333-3333-4333-8333-333333333333",
  booking_date: "2099-10-10",
  expected_attendees: 60,
  room_layout: "Theatre",
  required_facilities: ["Stage"],
  accessibility_requirements: [],
  additional_requirements: null,
  purpose: "Annual conference",
  submitted_at: "2099-09-01T00:00:00Z",
  decided_at: null,
  decision_note: null,
  status: "pending",
  venue: { id: VENUE_ID, name: "Marina Grand Ballroom", city: "Singapore", country: "Singapore", capacity: 120 },
  event: {
    id: EVENT_ID,
    name: "Assigned conference",
    status: "APPROVED",
    start_time: "2099-10-10T01:00:00Z",
    end_time: "2099-10-10T09:00:00Z",
  },
  slots: [{ slot: "am", status: "pending" }],
};

const passed = { passed: true, reasons: [] };
const unchecked = { passed: null, reasons: [] };

const REPORT = {
  event_id: EVENT_ID,
  event_name: "Assigned conference",
  results: [
    {
      booking_id: "booking-a",
      venue_name: "Marina Grand Ballroom",
      booking_date: "2099-10-10",
      slots: ["am"],
      status: "pending",
      overall: "passed",
      note: null,
      suitability: passed,
      availability: passed,
      conflicts: passed,
    },
    {
      booking_id: "booking-b",
      venue_name: "Orchard Seminar Room",
      booking_date: "2099-10-10",
      slots: ["am"],
      status: "pending",
      overall: "failed",
      note: null,
      suitability: { passed: false, reasons: ["expected_attendees (100) exceeds the venue capacity of 50"] },
      availability: passed,
      conflicts: { passed: false, reasons: ["AM is already taken by another event (Reserved event)."] },
    },
    {
      booking_id: "booking-c",
      venue_name: "Riverside Hall",
      booking_date: "2099-10-11",
      slots: ["pm"],
      status: "rejected",
      overall: "not_checked",
      note: "This booking is rejected and is no longer live, so it was not checked.",
      suitability: unchecked,
      availability: unchecked,
      conflicts: unchecked,
    },
  ],
};

const ok = (body) => ({ status: 200, ok: true, json: async () => body });
const fail = (status, error) => ({ status, ok: false, json: async () => ({ error }) });

let handlers;
beforeEach(() => {
  handlers = {};
});

const CANCEL_URL = `/api/venues/booking-requests/${REQUEST.id}/cancel`;
const CHANGE_URL = `/api/venues/booking-requests/${REQUEST.id}`;
const VENUE_URL = `/api/venues/${VENUE_ID}`;

const VENUE_DETAIL = {
  id: VENUE_ID, name: "Marina Grand Ballroom", city: "Singapore", country: "Singapore", capacity: 120,
  room_layouts: ["Theatre", "Banquet"], facilities: ["Stage", "Projector"], accessibility_features: ["Lift"],
};

function setup(roles = ["event_coordinator"]) {
  getAuthClient.mockResolvedValue({
    auth: {
      onAuthStateChange: vi.fn((callback) => {
        queueMicrotask(() => callback("INITIAL_SESSION", { access_token: "token", user: { id: "sdk" } }));
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  });

  const fetchMock = vi.fn(async (url, options = {}) => {
    if (url === "/api/auth/me") {
      return ok({
        user: {
          id: "coordinator",
          email: "coordinator@connectsphere.sg",
          fullName: "Event Coordinator",
          roles,
          accountTypes: ["internal"],
        },
        // The REAL policy decides, so this test fails if the permission is removed.
        permissions: getPermissions(roles),
      });
    }
    if (url === CHECKS_URL) {
      return (handlers.check ?? (() => ok({ data: REPORT })))();
    }
    if (url === CANCEL_URL && options.method === "PATCH") {
      return (handlers.cancel ?? (() => ok({ data: { ...REQUEST, status: "cancelled" } })))();
    }
    if (url === VENUE_URL) {
      return (handlers.venue ?? (() => ok({ data: VENUE_DETAIL })))();
    }
    if (url === CHANGE_URL && options.method === "PATCH") {
      return (handlers.change ?? (() => ok({ data: { ...REQUEST, status: "pending" } })))();
    }
    if (String(url).startsWith("/api/venues/booking-requests")) {
      return (handlers.list ?? (() => ok({ data: [REQUEST] })))();
    }
    throw new Error("Unexpected test request: " + url);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const open = (path = `/venues/booking-requests?event=${EVENT_ID}`) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );

async function runCheck(user) {
  // The App has to sign in, load permissions and fetch the list before the
  // button exists, so allow more than the default second on a slow machine.
  const button = await screen.findByRole(
    "button",
    { name: "Check venue bookings" },
    { timeout: 5000 }
  );
  await user.click(button);
  return button;
}

test("[SCRUM-138-UI-001] a coordinator checks the event's bookings and sees one card per venue", async () => {
  const fetchMock = setup();
  const user = userEvent.setup();
  open();

  await runCheck(user);

  expect(await screen.findByRole("heading", { name: "Marina Grand Ballroom" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Orchard Seminar Room" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Riverside Hall" })).toBeTruthy();
  // The check is asked for by event, and only when the coordinator asks.
  expect(fetchMock.mock.calls.map(([url]) => url)).toContain(CHECKS_URL);
});

test("[SCRUM-138-UI-002] the failing venue is named with its reasons, and the others are unaffected", async () => {
  setup();
  const user = userEvent.setup();
  open();
  await runCheck(user);

  const orchard = within((await screen.findByRole("heading", { name: "Orchard Seminar Room" })).closest("article"));
  expect(orchard.getAllByText("Failed")).toHaveLength(3);
  expect(orchard.getByText("expected_attendees (100) exceeds the venue capacity of 50")).toBeTruthy();
  expect(orchard.getByText("AM is already taken by another event (Reserved event).")).toBeTruthy();

  const marina = within(screen.getByRole("heading", { name: "Marina Grand Ballroom" }).closest("article"));
  // One verdict for the booking plus one per passing check.
  expect(marina.getAllByText("Passed")).toHaveLength(4);

  // The request card below still shows its own status: checking changed nothing.
  const requestCard = within(
    screen.getByRole("heading", { name: "Assigned conference" }).closest("article")
  );
  expect(requestCard.getByText("Pending review")).toBeTruthy();
});

test("[SCRUM-138-UI-003] a check in flight says so, and a failed one offers a retry that re-requests", async () => {
  const fetchMock = setup();
  let attempts = 0;
  let settle;
  handlers.check = () =>
    attempts++ === 0
      ? new Promise((resolve) => { settle = resolve; })
      : ok({ data: REPORT });

  const user = userEvent.setup();
  open();
  await runCheck(user);

  // While the check is in flight the button says so and cannot be pressed
  // twice, and the page states what it is doing.
  const inFlight = screen.getByRole("button", { name: "Checking..." });
  expect(inFlight.disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toMatch(/checking this event's venue bookings/i);

  settle(fail(500, "Failed to fetch venue"));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/could not check the venue bookings/i);
  expect(alert.textContent).toMatch(/Failed to fetch venue/);

  await user.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByRole("heading", { name: "Orchard Seminar Room" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(fetchMock.mock.calls.filter(([url]) => url === CHECKS_URL)).toHaveLength(2);
});

test("[SCRUM-138-UI-004] checking is offered only where the event is known", async () => {
  setup();
  open("/venues/booking-requests");

  // The whole-list view is not scoped to an event, so there is nothing to check
  // for a specific event and no button to press.
  expect(
    await screen.findByRole("heading", { name: "Venue booking requests" }, { timeout: 5000 })
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Check venue bookings" })).toBeNull();
});

test("[SCRUM-138-UI-005] a role without booking access cannot reach the page at all", async () => {
  setup(["event_coordinator_lead"]);
  open();

  expect(
    await screen.findByRole("heading", { name: "Access denied" }, { timeout: 5000 })
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Check venue bookings" })).toBeNull();
});

// ---------------------------------------------------------------------------
// SCRUM-154: the assigned coordinator cancels one venue booking from this
// same page. Same real App / real permission policy / faked fetch pattern.
// ---------------------------------------------------------------------------

test("[TC-SCRUM-154-UI-01] the assigned coordinator sees a cancel action on a pending booking", async () => {
  setup();
  open();

  expect(await screen.findByRole("button", { name: "Cancel this booking" }, { timeout: 5000 })).toBeTruthy();
});

test("[TC-SCRUM-154-UI-02] Venue Staff never see the cancel action, even on the same page", async () => {
  setup(["venue_staff"]);
  open();

  await screen.findByRole("heading", { name: "Assigned conference" }, { timeout: 5000 });
  expect(screen.queryByRole("button", { name: "Cancel this booking" })).toBeNull();
});

test("[TC-SCRUM-154-UI-03] cancelling asks for confirmation first, and backing out writes nothing", async () => {
  const fetchMock = setup();
  const user = userEvent.setup();
  open();

  await user.click(await screen.findByRole("button", { name: "Cancel this booking" }, { timeout: 5000 }));

  expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Never mind" }));

  expect(screen.getByRole("button", { name: "Cancel this booking" })).toBeTruthy();
  expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(CANCEL_URL);
});

test("[TC-SCRUM-154-UI-04] confirming cancels the booking and the card reflects it", async () => {
  const fetchMock = setup();
  let served = false;
  handlers.list = () => ok({ data: [served ? { ...REQUEST, status: "cancelled" } : REQUEST] });
  handlers.cancel = () => { served = true; return ok({ data: { ...REQUEST, status: "cancelled" } }); };

  const user = userEvent.setup();
  open();

  await user.click(await screen.findByRole("button", { name: "Cancel this booking" }, { timeout: 5000 }));
  await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));

  // Scoped to the status badge itself: the "Show" filter's own <option>
  // Cancelled</option> is always in the DOM too, and a bare findByText would
  // match both.
  expect(await screen.findByText("Cancelled", { selector: ".v-status" })).toBeTruthy();
  expect(fetchMock.mock.calls.map(([url]) => url)).toContain(CANCEL_URL);
  expect(screen.queryByRole("button", { name: "Cancel this booking" })).toBeNull();
});

test("[TC-SCRUM-154-UI-05] a booking that is no longer live shows the refusal, not a crash", async () => {
  setup();
  handlers.cancel = () => fail(409, "This booking is no longer live");

  const user = userEvent.setup();
  open();

  await user.click(await screen.findByRole("button", { name: "Cancel this booking" }, { timeout: 5000 }));
  await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));

  expect(await screen.findByText("This booking is no longer live")).toBeTruthy();
  // The card is untouched - still pending, still cancellable again.
  expect(screen.getByRole("button", { name: "Confirm cancellation" })).toBeTruthy();
});

test("[TC-SCRUM-154-UI-06] a rejected booking offers no cancel action - it is already terminal", async () => {
  setup();
  handlers.list = () => ok({ data: [{ ...REQUEST, status: "rejected", slots: [{ slot: "am", status: "rejected" }] }] });
  open();

  await screen.findByRole("heading", { name: "Assigned conference" }, { timeout: 5000 });
  expect(screen.queryByRole("button", { name: "Cancel this booking" })).toBeNull();
});

// ---------------------------------------------------------------------------
// SCRUM-154: the assigned coordinator changes a booking's date and non-slot
// details from the same page. Slot selection is out of scope by decision, so
// there is no slot picker to test - just the date and the create form's
// other fields.
// ---------------------------------------------------------------------------

test("[TC-SCRUM-154-UI-07] the assigned coordinator sees an edit action, and opening it loads this venue's requirements", async () => {
  setup();
  const user = userEvent.setup();
  open();

  await user.click(await screen.findByRole("button", { name: "Edit this booking" }, { timeout: 5000 }));

  expect(await screen.findByLabelText("Date")).toBeTruthy();
  expect(screen.getByLabelText("Date").value).toBe(REQUEST.booking_date);
  expect(screen.getByLabelText("Room layout").value).toBe(REQUEST.room_layout);
});

test("[TC-SCRUM-154-UI-08] Venue Staff never see the edit action, even on the same page", async () => {
  setup(["venue_staff"]);
  open();

  await screen.findByRole("heading", { name: "Assigned conference" }, { timeout: 5000 });
  expect(screen.queryByRole("button", { name: "Edit this booking" })).toBeNull();
});

test("[TC-SCRUM-154-UI-09] saving sends the edited fields and the new date, and the card reflects the result", async () => {
  const fetchMock = setup();
  const user = userEvent.setup();
  open();

  await user.click(await screen.findByRole("button", { name: "Edit this booking" }, { timeout: 5000 }));
  await screen.findByLabelText("Date");

  await user.clear(screen.getByLabelText("Expected attendees"));
  await user.type(screen.getByLabelText("Expected attendees"), "80");
  await user.clear(screen.getByLabelText("Date"));
  await user.type(screen.getByLabelText("Date"), "2099-11-01");

  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByText("Pending review", { selector: ".v-status" })).toBeTruthy();
  const [, body] = fetchMock.mock.calls.find(([url]) => url === CHANGE_URL);
  expect(JSON.parse(body.body)).toEqual(expect.objectContaining({
    booking_date: "2099-11-01", expected_attendees: 80, room_layout: REQUEST.room_layout,
  }));
  expect(screen.queryByLabelText("Date")).toBeNull();
});

test("[TC-SCRUM-154-UI-10] discarding changes closes the form without saving", async () => {
  const fetchMock = setup();
  const user = userEvent.setup();
  open();

  await user.click(await screen.findByRole("button", { name: "Edit this booking" }, { timeout: 5000 }));
  await screen.findByLabelText("Date");
  await user.click(screen.getByRole("button", { name: "Discard changes" }));

  expect(screen.getByRole("button", { name: "Edit this booking" })).toBeTruthy();
  expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(CHANGE_URL);
});

test("[TC-SCRUM-154-UI-11] a booking that is no longer live shows the refusal, not a crash", async () => {
  setup();
  handlers.change = () => fail(409, "This booking is no longer live");

  const user = userEvent.setup();
  open();

  await user.click(await screen.findByRole("button", { name: "Edit this booking" }, { timeout: 5000 }));
  await screen.findByLabelText("Date");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByText("This booking is no longer live")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
});

test("[TC-SCRUM-154-UI-12] a rejected booking offers no edit action - it is already terminal", async () => {
  setup();
  handlers.list = () => ok({ data: [{ ...REQUEST, status: "rejected", slots: [{ slot: "am", status: "rejected" }] }] });
  open();

  await screen.findByRole("heading", { name: "Assigned conference" }, { timeout: 5000 });
  expect(screen.queryByRole("button", { name: "Edit this booking" })).toBeNull();
});
