// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { fetchEventRegistrationSummary, fetchManagedEvents } from "../managedEventsService";
import ManagedEventDetailPage from "./ManagedEventDetailPage";
import ManagedEventsPage from "./ManagedEventsPage";

vi.mock("../../auth/useAuth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../managedEventsService", () => ({
  fetchEventRegistrationSummary: vi.fn(),
  fetchManagedEvents: vi.fn(),
}));

const EVENT = {
  id: "aaaaaaaa-0001-0000-0000-000000000000",
  name: "Annual Alumni Gala",
  status: "APPROVED",
  enrolled: 3,
  maxEnrollment: 3,
  waitingList: 0,
  start_time: null,
  end_time: null,
};

beforeEach(() => {
  useAuth.mockReturnValue({ token: "test-token" });
  fetchManagedEvents.mockResolvedValue([EVENT]);
  fetchEventRegistrationSummary.mockResolvedValue(EVENT);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("the managed event list shows registrations against capacity and marks a full event", async () => {
  render(<MemoryRouter><ManagedEventsPage /></MemoryRouter>);

  const event = await screen.findByRole("link", { name: /Annual Alumni Gala/ });
  expect(event).toHaveTextContent("3/3 registered");
  expect(event).toHaveTextContent("Full");
});

test("the managed event detail marks the event full at its capacity", async () => {
  render(
    <MemoryRouter initialEntries={[`/events/managed/${EVENT.id}`]}>
      <ManagedEventDetailPage />
    </MemoryRouter>,
  );

  expect(await screen.findByText("3/3")).toBeTruthy();
  expect(screen.getByText("Full")).toBeTruthy();
});

test("an uncapped event is not marked full", async () => {
  fetchEventRegistrationSummary.mockResolvedValue({ ...EVENT, maxEnrollment: null });
  render(
    <MemoryRouter initialEntries={[`/events/managed/${EVENT.id}`]}>
      <ManagedEventDetailPage />
    </MemoryRouter>,
  );

  expect(await screen.findByText("3/-")).toBeTruthy();
  expect(screen.queryByText("Full")).toBeNull();
});
