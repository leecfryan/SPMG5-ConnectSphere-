// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { useRegistrationResource } from "./hooks/useRegistrationResource";
import { useEventRegistration } from "./hooks/useEventRegistration";
import EventListPage from "./pages/EventListPage";
import EventDetailPage from "./pages/EventDetailPage";

vi.mock("./hooks/useRegistrationResource", () => ({
  useRegistrationResource: vi.fn(),
}));

vi.mock("./hooks/useEventRegistration", () => ({
  useEventRegistration: vi.fn(),
}));

const EVENT_ID = "aaaaaaaa-0001-0000-0000-000000000000";
const NOW = new Date("2030-01-01T00:00:00.000Z").getTime();

const EVENT = {
  id: EVENT_ID,
  name: "Window event",
  description: "Registration-window test",
  purpose: "Exercise the window UI",
  start_time: "2030-01-02T10:00:00.000Z",
  end_time: "2030-01-02T12:00:00.000Z",
  registration_fields: [],
  status: "APPROVED",
  enrolled_attendees: 0,
  expected_attendance: 10,
  registration_start: null,
  registration_end: null,
};

function renderDetail(event, serverTime = new Date(NOW).toISOString(), refresh = vi.fn()) {
  useRegistrationResource.mockReturnValue({
    data: { event, server_time: serverTime },
    receivedAt: Date.now(),
    refresh,
  });
  return render(
    <MemoryRouter initialEntries={[`/events/${EVENT_ID}`]}>
      <Routes>
        <Route path="/events/:eventId" element={<EventDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  useEventRegistration.mockReturnValue({
    register: vi.fn(),
    busy: false,
    error: "",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

test("registration before the start disables the button and shows a live countdown", async () => {
  const event = {
    ...EVENT,
    registration_start: new Date(NOW + 5_000).toISOString(),
  };
  renderDetail(event);

  expect(screen.getByRole("button", { name: /register for this event/i })).toBeDisabled();
  expect(screen.getByText(/registration opens on/i)).toBeInTheDocument();
  expect(screen.getByText("Opens in 0 days, 0 hours, 0 minutes, 5 seconds.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /register for this event/i }))
    .toHaveAttribute("aria-describedby", `registration-window-message-${EVENT_ID}`);

  await act(async () => vi.advanceTimersByTimeAsync(1000));

  expect(screen.getByText("Opens in 0 days, 0 hours, 0 minutes, 4 seconds.")).toBeInTheDocument();
});

test("the opening transition enables registration only after server confirmation", async () => {
  const start = new Date(NOW + 1000).toISOString();
  const refresh = vi.fn().mockResolvedValue({ server_time: new Date(NOW + 1100).toISOString() });
  renderDetail({ ...EVENT, registration_start: start }, new Date(NOW).toISOString(), refresh);

  const button = screen.getByRole("button", { name: /register for this event/i });
  expect(button).toBeDisabled();

  await act(async () => vi.advanceTimersByTimeAsync(1000));

  expect(refresh).toHaveBeenCalledTimes(1);
  expect(button).toBeEnabled();
});

test("a stale server response leaves registration disabled after bounded retries", async () => {
  const start = new Date(NOW + 1000).toISOString();
  const refresh = vi.fn().mockResolvedValue({ server_time: new Date(NOW).toISOString() });
  renderDetail({ ...EVENT, registration_start: start }, new Date(NOW).toISOString(), refresh);

  const button = screen.getByRole("button", { name: /register for this event/i });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await act(async () => vi.advanceTimersByTimeAsync(2000));

  expect(refresh).toHaveBeenCalledTimes(4);
  expect(button).toBeDisabled();
  expect(screen.getByText(/server confirmation is still pending/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
});

test("registration after the end is disabled with a close message", () => {
  const event = {
    ...EVENT,
    registration_end: new Date(NOW - 1).toISOString(),
  };
  renderDetail(event);

  expect(screen.getByRole("button", { name: /register for this event/i })).toBeDisabled();
  expect(screen.getByText(/registration closed on/i)).toBeInTheDocument();
});

test("registration inside the window is enabled and shows the closing time", () => {
  const event = {
    ...EVENT,
    registration_start: new Date(NOW - 1000).toISOString(),
    registration_end: new Date(NOW + 60_000).toISOString(),
  };
  renderDetail(event);

  expect(screen.getByRole("button", { name: /register for this event/i })).toBeEnabled();
  expect(screen.getByText(/registration closes on/i)).toBeInTheDocument();
});

test("null boundaries preserve the legacy enabled form without added window messaging", () => {
  renderDetail(EVENT);

  expect(screen.getByRole("button", { name: /register for this event/i })).toBeEnabled();
  expect(screen.queryByText(/registration opens on|registration closes on|registration closed on/i))
    .not.toBeInTheDocument();
});

test("a full event retains the Full state instead of showing a registration form", () => {
  const event = {
    ...EVENT,
    enrolled_attendees: 10,
    registration_start: new Date(NOW + 60_000).toISOString(),
  };
  renderDetail(event);

  expect(screen.getByText(/this event is full/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /register for this event/i })).not.toBeInTheDocument();
});

test("event browsing also displays its registration opening window", () => {
  const event = {
    ...EVENT,
    registration_start: new Date(NOW + 60_000).toISOString(),
  };
  useRegistrationResource.mockReturnValue({
    data: { events: [event], server_time: new Date(NOW).toISOString() },
    receivedAt: Date.now(),
    refresh: vi.fn(),
  });
  render(<MemoryRouter><EventListPage /></MemoryRouter>);

  expect(screen.getByText(/registration opens on/i)).toBeInTheDocument();
  expect(screen.getByText(/opens in 0 days, 0 hours, 1 minutes, 0 seconds/i)).toBeInTheDocument();
});

test("the countdown interval is cleaned up when the event page unmounts", () => {
  const event = {
    ...EVENT,
    registration_start: new Date(NOW + 60_000).toISOString(),
  };
  const view = renderDetail(event);
  expect(vi.getTimerCount()).toBeGreaterThan(0);

  view.unmount();

  expect(vi.getTimerCount()).toBe(0);
});
