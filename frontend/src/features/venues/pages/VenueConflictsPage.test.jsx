// @vitest-environment jsdom
// SCRUM-135 AC4: Venue Staff view booking conflict flags.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import VenueConflictsPage from "./VenueConflictsPage";

vi.mock("../../auth/useAuth", () => ({
  useAuth: () => ({ token: "venue_staff" }),
}));
vi.mock("../venueConflictsService");

import { fetchConflictFlags } from "../venueConflictsService";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const VENUE = { id: "11111111-1111-4111-8111-111111111111", name: "Marina Grand Ballroom" };

const FLAG = {
  slot: "am",
  type: "setup",
  conflicting_with: "Morning Session",
  reason: 'am is needed for setup time but is occupied by "Morning Session"',
};

const FLAGGED_REQUEST = {
  id: "aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  booking_date: "2099-10-10",
  status: "confirmed",
  event: { id: "bbbb0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Charity Gala",
    status: "APPROVED", start_time: "2099-10-10T01:00:00Z", end_time: "2099-10-10T09:00:00Z" },
  venue: VENUE,
  slots: [{ slot: "pm", status: "confirmed" }],
  conflict_flags: [FLAG],
};

test("[TC-SCRUM-135-UI-01] shows event name, booking date and conflict reason for each flagged request", async () => {
  fetchConflictFlags.mockResolvedValue({ data: [FLAGGED_REQUEST] });

  render(<VenueConflictsPage venue={VENUE} onBack={() => {}} />);

  expect(await screen.findByText("Charity Gala")).toBeTruthy();
  expect(screen.getByText(/10 Oct 2099/)).toBeTruthy();
  expect(screen.getByText(FLAG.reason)).toBeTruthy();
});

test("[TC-SCRUM-135-UI-02] shows empty state when no conflict flags exist", async () => {
  fetchConflictFlags.mockResolvedValue({ data: [] });

  render(<VenueConflictsPage venue={VENUE} onBack={() => {}} />);

  expect(await screen.findByText("No conflict flags.")).toBeTruthy();
  expect(screen.queryByRole("article")).toBeNull();
});

test("[TC-SCRUM-135-UI-03] shows error message when load fails", async () => {
  fetchConflictFlags.mockRejectedValue(new Error("Service unavailable"));

  render(<VenueConflictsPage venue={VENUE} onBack={() => {}} />);

  expect(await screen.findByText(/Could not load conflict flags/)).toBeTruthy();
  expect(screen.queryByRole("article")).toBeNull();
});

test("[TC-SCRUM-135-UI-04] shows loading state before data arrives", () => {
  fetchConflictFlags.mockReturnValue(new Promise(() => {}));

  render(<VenueConflictsPage venue={VENUE} onBack={() => {}} />);

  expect(screen.getByText("Loading conflict flags…")).toBeTruthy();
});
