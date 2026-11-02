// @vitest-environment jsdom
// SCRUM-38: the coordinator is told when an accepted change makes a venue
// booking stop fitting, and the flagged booking stays on their event page with
// its reason and the replacement link. Only network transport is faked.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import VenueRecheckNotice from "./VenueRecheckNotice";
import VenueAttentionPanel from "./VenueAttentionPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EVENT_ID = "aaaaaaaa-0038-4000-8000-000000000001";
const REASON = "After the event changed: Over capacity: the venues booked on 2099-10-10 hold 50, fewer than the 240 people now expected.";
const ok = (body) => ({ status: 200, ok: true, json: async () => body });

function renderPanel(respond) {
  vi.stubGlobal("fetch", vi.fn(async (url) => respond(url)));
  render(<AuthContext.Provider value={{ token: "coordinator-token" }}>
    <MemoryRouter><VenueAttentionPanel eventId={EVENT_ID} /></MemoryRouter>
  </AuthContext.Provider>);
}

test("[SCRUM-38-UI-001] after an accepted change, the notice names each venue that no longer fits and why, and can be dismissed", async () => {
  const onDismiss = vi.fn();
  render(<VenueRecheckNotice recheck={{ checked: 2, flagged: [{ booking_id: "b1", venue_name: "Hall A", reason: REASON }] }} onDismiss={onDismiss} />);
  const notice = screen.getByRole("status");
  expect(notice).toHaveTextContent("1 venue booking no longer fits the updated event");
  const item = within(notice).getByRole("listitem");
  expect(item).toHaveTextContent("Hall A");
  // The "After the event changed:" prefix is not repeated under a heading that already says so.
  expect(item).toHaveTextContent("Over capacity: the venues booked on 2099-10-10 hold 50, fewer than the 240 people now expected.");
  expect(item).not.toHaveTextContent("After the event changed");
  await userEvent.setup().click(within(notice).getByRole("button", { name: "Dismiss" }));
  expect(onDismiss).toHaveBeenCalledOnce();
});

test("[SCRUM-38-UI-002] when every venue still fits, the notice says so and lists nothing", () => {
  render(<VenueRecheckNotice recheck={{ checked: 2, flagged: [] }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Venue bookings re-checked");
  expect(screen.getByRole("status")).toHaveTextContent("All 2 bookings still fit the updated event.");
  expect(screen.queryByRole("list")).toBeNull();
});

test("[SCRUM-38-UI-003] a re-check that could not run says the change stands and when it will be checked again", () => {
  render(<VenueRecheckNotice recheck={{ failed: true }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Venue bookings could not be re-checked");
  expect(screen.getByRole("status")).toHaveTextContent("The change was saved.");
});

test("[SCRUM-38-UI-004] nothing to say when no re-check ran or there were no bookings", () => {
  const { container, rerender } = render(<VenueRecheckNotice recheck={null} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<VenueRecheckNotice recheck={{ checked: 0, flagged: [] }} />);
  expect(container).toBeEmptyDOMElement();
});

test("[SCRUM-38-UI-005] the event page lists each flagged booking with its venue, date, reason and replacement link; others are not shown", async () => {
  renderPanel((url) => {
    expect(url).toBe(`/api/venues/booking-requests?event_id=${EVENT_ID}`);
    return ok({ data: [
      { id: "flagged-1", booking_date: "2099-10-10", status: "confirmed", is_affected: true, affected_reason: REASON, venue: { name: "Hall A" } },
      { id: "fine-2", booking_date: "2099-10-10", status: "confirmed", is_affected: false, venue: { name: "Hall B" } },
      { id: "released-3", booking_date: "2099-10-10", status: "cancelled", is_affected: true, affected_reason: "Old", venue: { name: "Hall C" } },
    ] });
  });

  const panel = await screen.findByRole("region", { name: "A venue booking no longer fits this event" });
  expect(within(panel).getAllByRole("listitem")).toHaveLength(1);
  expect(panel).toHaveTextContent("Hall A");
  expect(panel).toHaveTextContent("Over capacity: the venues booked on 2099-10-10 hold 50");
  expect(panel).not.toHaveTextContent("After the event changed");
  expect(within(panel).getByRole("link", { name: "Find replacement venue" })).toHaveAttribute("href", "/venues/booking-requests/flagged-1/replacement");
  expect(within(panel).getByRole("link", { name: "Release on My Events" })).toHaveAttribute("href", `/events/managed/${EVENT_ID}`);
  expect(panel).not.toHaveTextContent("Hall B");
  expect(panel).not.toHaveTextContent("Hall C");
});

test("[SCRUM-38-UI-006] with nothing flagged the event page shows no venue warning", async () => {
  renderPanel(() => ok({ data: [{ id: "fine", booking_date: "2099-10-10", status: "confirmed", is_affected: false, venue: { name: "Hall B" } }] }));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  await Promise.resolve();
  expect(screen.queryByRole("region")).toBeNull();
});

test("[SCRUM-38-UI-007] a failed load says so instead of hiding a possible problem", async () => {
  renderPanel(() => ({ status: 503, ok: false, json: async () => ({ error: "Venue storage unavailable" }) }));
  expect(await screen.findByRole("alert")).toHaveTextContent("venue bookings could not be loaded");
});
